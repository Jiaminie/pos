import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, canManageUsers } from '@/lib/server/auth/guard'
import { hashPin, validatePinFormat, verifyPin } from '@/lib/server/auth/pin'
import { logAudit } from '@/lib/server/audit'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  if (!(await canManageUsers(user))) {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || target.organizationId !== user.orgId) {
    return Response.json({ data: null, error: 'User not found' }, { status: 404 })
  }

  if (user.role === 'MANAGER') {
    if (target.role !== 'CASHIER' || target.branchId !== user.branchId) {
      return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
    }
  }

  if (target.role === 'OWNER' && user.role !== 'OWNER') {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { name, pin, currentPin, active, role, branchId } = body as {
      name?: string
      pin?: string
      currentPin?: string
      active?: boolean
      role?: string
      branchId?: string
    }

    if (pin) {
      const pinErr = validatePinFormat(pin)
      if (pinErr) return Response.json({ data: null, error: pinErr }, { status: 400 })

      // Changing your own PIN requires proving you know the current one. A
      // mistyped or unattended change here locks you out of the account with
      // no way back in — and for the sole OWNER, out of the system entirely.
      if (id === user.userId && !(currentPin && (await verifyPin(currentPin, target.pinHash)))) {
        return Response.json(
          { data: null, error: 'Enter your current PIN to change it' },
          { status: 403 },
        )
      }
    }

    if (role === 'MANAGER' && branchId) {
      const existing = await prisma.user.findFirst({
        where: { branchId, role: 'MANAGER', active: true, NOT: { id } },
      })
      if (existing) {
        return Response.json(
          { data: null, error: 'This branch already has a manager' },
          { status: 409 },
        )
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(active !== undefined && { active }),
        ...(pin ? { pinHash: await hashPin(pin) } : {}),
        ...(user.role === 'OWNER' && role ? { role: role as never } : {}),
        ...(user.role === 'OWNER' && branchId !== undefined ? { branchId } : {}),
      },
      include: { branch: { select: { id: true, name: true, code: true } } },
    })

    await logAudit({
      organizationId: user.orgId,
      actorId: user.userId,
      actorName: user.name,
      action: 'USER_UPDATE',
      branchId: updated.branchId ?? target.branchId ?? undefined,
      targetType: 'User',
      targetId: id,
      metadata: {
        name: target.name,
        self: id === user.userId,
        // Record *that* the PIN changed, never the PIN or its hash.
        pinChanged: Boolean(pin),
        ...(name !== undefined && name.trim() !== target.name && {
          nameFrom: target.name,
          nameTo: name.trim(),
        }),
        ...(active !== undefined && active !== target.active && { activeTo: active }),
        ...(user.role === 'OWNER' && role && role !== target.role && {
          roleFrom: target.role,
          roleTo: role,
        }),
        ...(user.role === 'OWNER' &&
          branchId !== undefined &&
          branchId !== target.branchId && {
            branchFrom: target.branchId,
            branchTo: branchId,
          }),
      },
    })

    const { pinHash: _, ...safe } = updated
    return Response.json({ data: safe, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  if (!(await canManageUsers(user))) {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (id === user.userId) {
    return Response.json({ data: null, error: 'Cannot delete your own account' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({ where: { id } })
  if (!target || target.organizationId !== user.orgId) {
    return Response.json({ data: null, error: 'User not found' }, { status: 404 })
  }

  if (target.role === 'OWNER') {
    return Response.json({ data: null, error: 'Cannot delete the owner account' }, { status: 400 })
  }

  if (user.role === 'MANAGER') {
    if (target.role !== 'CASHIER' || target.branchId !== user.branchId) {
      return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
    }
  }

  const salesCount = await prisma.sale.count({ where: { cashierId: id } })
  if (salesCount > 0) {
    return Response.json(
      { data: null, error: 'User has sales history — deactivate instead' },
      { status: 400 },
    )
  }

  try {
    await prisma.user.delete({ where: { id } })

    await logAudit({
      organizationId: user.orgId,
      actorId: user.userId,
      actorName: user.name,
      action: 'USER_DELETE',
      branchId: target.branchId ?? undefined,
      targetType: 'User',
      targetId: id,
      metadata: { name: target.name, role: target.role },
    })

    return Response.json({ data: { id }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
