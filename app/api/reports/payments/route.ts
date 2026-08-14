import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, branchFilter } from '@/lib/server/auth/guard'
import { hasPermission } from '@/lib/server/auth/permissions'
import { paymentKey, methodLabel } from '@/lib/payments'

export async function GET(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  const canOrg = await hasPermission(user, 'reports.view.org')
  const canBranch = await hasPermission(user, 'reports.view.branch')
  const canOwn = await hasPermission(user, 'reports.view.own')
  if (!canOrg && !canBranch && !canOwn) {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const requestedBranch = searchParams.get('branchId')
  const filter = branchFilter(user, requestedBranch)

  const dateFilter =
    from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
          },
        }
      : {}

  const sales = await prisma.sale.findMany({
    where: {
      organizationId: user.orgId,
      voidedAt: null, // voided sales never count toward takings
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(canOwn && !canOrg && !canBranch ? { cashierId: user.userId } : {}),
      ...dateFilter,
    },
    select: {
      id: true,
      total: true,
      payments: { select: { method: true, bankName: true, amount: true } },
    },
  })

  const byMethod = new Map<string, { key: string; label: string; method: string; bankName: string | null; count: number; amount: number }>()

  let unrecordedAmount = 0
  let unrecordedCount = 0

  for (const sale of sales) {
    const total = Number(sale.total)
    if (sale.payments.length === 0) {
      unrecordedAmount += total
      unrecordedCount += 1
      continue
    }
    for (const p of sale.payments) {
      const key = paymentKey(p.method, p.bankName)
      const entry = byMethod.get(key) ?? {
        key,
        label: methodLabel(p.method, p.bankName),
        method: p.method,
        bankName: p.method === 'BANK' ? p.bankName : null,
        count: 0,
        amount: 0,
      }
      entry.count += 1
      entry.amount += Number(p.amount)
      byMethod.set(key, entry)
    }
  }

  const voidedExcludedCount = await prisma.sale.count({
    where: {
      organizationId: user.orgId,
      voidedAt: { not: null },
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(canOwn && !canOrg && !canBranch ? { cashierId: user.userId } : {}),
      ...dateFilter,
    },
  })

  const total = sales.reduce((s, sale) => s + Number(sale.total), 0)

  return Response.json({
    data: {
      byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
      unrecordedAmount,
      unrecordedCount,
      total: Math.round(total * 100) / 100,
      saleCount: sales.length,
      voidedExcludedCount,
    },
    error: null,
  })
}