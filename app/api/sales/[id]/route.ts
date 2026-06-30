import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, assertBranchAccess, type AuthUser } from '@/lib/server/auth/guard'
import { hasPermission } from '@/lib/server/auth/permissions'
import { verifyPin } from '@/lib/server/auth/pin'
import { logAudit } from '@/lib/server/audit'
import { alertSaleVoided } from '@/lib/server/alerts'

/**
 * Void / refund a completed sale. The logged-in user *initiates*; an authority
 * holding `sales.void` *approves*. If the initiator already holds it (manager /
 * owner) they self-approve; otherwise a manager step-up PIN is required. The
 * void reverses stock, is audit-logged with both actors, and alerts the owner.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  const { id } = await params

  try {
    const body = await request.json().catch(() => ({}))
    const { managerPin, reason } = body as { managerPin?: string; reason?: string }

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { lines: true, branch: { select: { name: true } } },
    })
    if (!sale || sale.organizationId !== user.orgId) {
      return Response.json({ data: null, error: 'Sale not found' }, { status: 404 })
    }

    const branchErr = assertBranchAccess(user, sale.branchId)
    if (branchErr) return branchErr

    if (sale.voidedAt) {
      return Response.json({ data: null, error: 'Sale already voided' }, { status: 409 })
    }

    // Resolve the approver who holds `sales.void`.
    const approver = await resolveApprover(user, sale.organizationId, sale.branchId, managerPin)
    if (!approver) {
      return Response.json(
        { data: null, error: 'A manager PIN with void authority is required' },
        { status: 403 },
      )
    }

    const voided = await prisma.$transaction(async (tx) => {
      const updated = await tx.sale.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: approver.userId, voidReason: reason ?? null },
      })

      // Reverse stock: a RETURN per sold line restores quantity.
      for (const line of sale.lines) {
        await tx.inventoryTransaction.create({
          data: {
            productId: line.productId,
            type: 'RETURN',
            branchId: sale.branchId,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            saleId: sale.id,
            deviceId: line.deviceId,
            syncedAt: new Date(),
          },
        })
      }

      await logAudit(
        {
          organizationId: sale.organizationId,
          actorId: user.userId,
          actorName: user.name,
          approvedById: approver.userId,
          action: 'SALE_VOID',
          branchId: sale.branchId,
          targetType: 'Sale',
          targetId: sale.id,
          metadata: { amount: Number(sale.total), reason: reason ?? null, approver: approver.name },
        },
        tx,
      )

      return updated
    })

    await alertSaleVoided({
      saleId: sale.id,
      amount: Number(sale.total),
      branchName: sale.branch?.name ?? sale.branchId,
      cashierName: user.name,
      approverName: approver.name,
      reason: reason ?? null,
    })

    return Response.json({ data: voided, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

/** The initiator self-approves if they hold the authority; else verify a step-up PIN. */
async function resolveApprover(
  initiator: AuthUser,
  organizationId: string,
  branchId: string,
  managerPin?: string,
): Promise<{ userId: string; name: string } | null> {
  if (await hasPermission(initiator, 'sales.void')) {
    return { userId: initiator.userId, name: initiator.name }
  }
  if (!managerPin) return null

  // Candidates who could approve: owners (org-wide) + active staff of this branch.
  const candidates = await prisma.user.findMany({
    where: {
      organizationId,
      active: true,
      OR: [{ role: 'OWNER' }, { branchId }],
    },
  })

  for (const c of candidates) {
    if (!(await verifyPin(managerPin, c.pinHash))) continue
    const asAuth: AuthUser = {
      userId: c.id,
      role: c.role,
      branchId: c.branchId,
      orgId: c.organizationId,
      name: c.name,
    }
    if (await hasPermission(asAuth, 'sales.void')) {
      return { userId: c.id, name: c.name }
    }
  }
  return null
}
