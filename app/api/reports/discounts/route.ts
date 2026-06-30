import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, branchFilter } from '@/lib/server/auth/guard'
import { hasPermission } from '@/lib/server/auth/permissions'

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
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(canOwn && !canOrg && !canBranch ? { cashierId: user.userId } : {}),
      ...dateFilter,
    },
    include: {
      cashier: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true, code: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          originalUnitPrice: true,
          lineDiscountAmount: true,
          product: { select: { name: true, sku: true, sellingPrice: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const byCashier = new Map<
    string,
    { cashierId: string; name: string; count: number; discountTotal: number; revenue: number; listTotal: number }
  >()

  const discountedLines: Array<{
    saleId: string
    createdAt: Date
    cashierName: string
    branchName: string
    productName: string
    sku: string
    quantity: number
    lineDiscount: number
    originalUnitPrice: number
    unitPrice: number
  }> = []

  for (const sale of sales) {
    const cid = sale.cashierId
    const entry = byCashier.get(cid) ?? {
      cashierId: cid,
      name: sale.cashier.name,
      count: 0,
      discountTotal: 0,
      revenue: 0,
      listTotal: 0,
    }
    entry.count += 1
    entry.discountTotal += Number(sale.lineDiscountTotal) + Number(sale.saleDiscountAmount)
    entry.revenue += Number(sale.total)
    entry.listTotal += Number(sale.subtotal)
    byCashier.set(cid, entry)

    for (const line of sale.lines) {
      const disc = Number(line.lineDiscountAmount ?? 0)
      if (disc <= 0) continue
      discountedLines.push({
        saleId: sale.id,
        createdAt: sale.createdAt,
        cashierName: sale.cashier.name,
        branchName: sale.branch.name,
        productName: line.product.name,
        sku: line.product.sku,
        quantity: Number(line.quantity),
        lineDiscount: disc,
        originalUnitPrice: Number(line.originalUnitPrice ?? line.product.sellingPrice),
        unitPrice: Number(line.unitPrice ?? 0),
      })
    }
  }

  const cashierStats = [...byCashier.values()].map((c) => ({
    ...c,
    avgDiscountPct: c.listTotal > 0 ? Math.round((c.discountTotal / c.listTotal) * 1000) / 10 : 0,
  }))

  const byBranch = new Map<string, { branchId: string; name: string; count: number; revenue: number }>()
  for (const sale of sales) {
    const entry = byBranch.get(sale.branchId) ?? {
      branchId: sale.branchId,
      name: sale.branch.name,
      count: 0,
      revenue: 0,
    }
    entry.count += 1
    entry.revenue += Number(sale.total)
    byBranch.set(sale.branchId, entry)
  }

  return Response.json({
    data: {
      cashierStats,
      branchStats: [...byBranch.values()],
      discountedLines,
      saleCount: sales.length,
    },
    error: null,
  })
}
