import { NextRequest } from 'next/server'
import { isAuthUser, assertBranchAccess, requireUserWithPermission } from '@/lib/server/auth/guard'
import { validateAndBuildSale, createSaleRecord } from '@/lib/server/sales'
import { logAudit } from '@/lib/server/audit'
import { alertHighDiscount } from '@/lib/server/alerts'
import { prisma } from '@/lib/server/db'

// Discount past this share of the pre-discount total alerts the owner.
const HIGH_DISCOUNT_PCT = 0.2

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'sales.create')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const { id, branchId, deviceId, lines, saleDiscountAmount, createdAt, wasOffline } = body

    if (!id || !branchId || !deviceId || !Array.isArray(lines) || lines.length === 0) {
      return Response.json(
        { data: null, error: 'id, branchId, deviceId, and lines are required' },
        { status: 400 },
      )
    }

    const branchErr = assertBranchAccess(user, branchId)
    if (branchErr) return branchErr

    const built = await validateAndBuildSale(
      { id, branchId, deviceId, lines, saleDiscountAmount, createdAt },
      user.userId,
      user.orgId,
    )

    const { sale, created } = await createSaleRecord(built)

    // Accountability + anomaly signals — only on first write, not re-syncs.
    if (created) {
      const discountTotal = built.lineDiscountTotal + built.saleDiscountAmount
      await logAudit({
        organizationId: user.orgId,
        actorId: user.userId,
        actorName: user.name,
        action: 'SALE_CREATE',
        branchId,
        targetType: 'Sale',
        targetId: sale.id,
        deviceId,
        wasOffline: Boolean(wasOffline),
        metadata: { total: built.total, discountTotal, lines: built.lines.length },
      })

      const preDiscount = built.total + discountTotal
      if (discountTotal > 0 && preDiscount > 0 && discountTotal / preDiscount >= HIGH_DISCOUNT_PCT) {
        await logAudit({
          organizationId: user.orgId,
          actorId: user.userId,
          actorName: user.name,
          action: 'DISCOUNT_APPLIED',
          branchId,
          targetType: 'Sale',
          targetId: sale.id,
          metadata: { discountTotal, total: built.total },
        })
        const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } })
        await alertHighDiscount({
          saleId: sale.id,
          discount: discountTotal,
          total: built.total,
          branchName: branch?.name ?? branchId,
          cashierName: user.name,
        })
      }
    }

    return Response.json({ data: sale, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = message.includes('floor') ? 400 : 500
    return Response.json({ data: null, error: message }, { status })
  }
}
