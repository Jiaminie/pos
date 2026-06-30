import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, canManageUsers } from '@/lib/server/auth/guard'
import { hashPin, validatePinFormat } from '@/lib/server/auth/pin'

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
    const { name, pin, active, role, branchId } = body as {
      name?: string
      pin?: string
      active?: boolean
      role?: string
      branchId?: string
    }

    if (pin) {
      const pinErr = validatePinFormat(pin)
      if (pinErr) return Response.json({ data: null, error: pinErr }, { status: 400 })
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

    const { pinHash: _, ...safe } = updated
    return Response.json({ data: safe, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
