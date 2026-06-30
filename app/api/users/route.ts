import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, canManageUsers, requirePermission, branchFilter } from '@/lib/server/auth/guard'
import { hashPin, validatePinFormat } from '@/lib/server/auth/pin'
import { logAudit } from '@/lib/server/audit'
import type { Role } from '@prisma/client'

export async function GET(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  if (!(await canManageUsers(user))) {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const requestedBranch = searchParams.get('branchId')
  const filter = branchFilter(user, requestedBranch)

  const users = await prisma.user.findMany({
    where: {
      organizationId: user.orgId,
      ...(user.role === 'MANAGER' ? { branchId: user.branchId ?? undefined, role: 'CASHIER' } : {}),
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
    },
    include: { branch: { select: { id: true, name: true, code: true } } },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  })

  const safe = users.map(({ pinHash: _, ...u }) => u)
  return Response.json({ data: safe, error: null })
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  if (!(await canManageUsers(user))) {
    return Response.json({ data: null, error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { name, pin, role, branchId } = body as {
      name?: string
      pin?: string
      role?: Role
      branchId?: string
    }

    if (!name?.trim() || !pin || !role) {
      return Response.json(
        { data: null, error: 'name, pin, and role are required' },
        { status: 400 },
      )
    }

    const pinErr = validatePinFormat(pin)
    if (pinErr) return Response.json({ data: null, error: pinErr }, { status: 400 })

    if (user.role === 'MANAGER') {
      if (role !== 'CASHIER') {
        return Response.json({ data: null, error: 'Managers can only create cashiers' }, { status: 403 })
      }
      if (branchId && branchId !== user.branchId) {
        return Response.json({ data: null, error: 'Cannot create cashier in another branch' }, { status: 403 })
      }
    }

    if (role === 'OWNER') {
      return Response.json({ data: null, error: 'Cannot create another owner' }, { status: 400 })
    }

    const targetBranchId = user.role === 'MANAGER' ? user.branchId : branchId
    if (!targetBranchId) {
      return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
    }

    if (role === 'MANAGER') {
      const denied = await requirePermission(user, 'admin.users.manage_managers')
      if (!isAuthUser(denied)) return denied

      const existing = await prisma.user.findFirst({
        where: { branchId: targetBranchId, role: 'MANAGER', active: true },
      })
      if (existing) {
        return Response.json(
          { data: null, error: 'This branch already has a manager' },
          { status: 409 },
        )
      }
    }

    const pinHash = await hashPin(pin)
    const created = await prisma.user.create({
      data: {
        name: name.trim(),
        pinHash,
        role,
        organizationId: user.orgId,
        branchId: targetBranchId,
        createdById: user.userId,
      },
      include: { branch: { select: { id: true, name: true, code: true } } },
    })

    await logAudit({
      organizationId: user.orgId,
      actorId: user.userId,
      actorName: user.name,
      action: 'USER_CREATE',
      branchId: targetBranchId,
      targetType: 'User',
      targetId: created.id,
      metadata: { name: created.name, role: created.role },
    })

    const { pinHash: _, ...safe } = created
    return Response.json({ data: safe, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('one_manager_per_branch')) {
      return Response.json({ data: null, error: 'This branch already has a manager' }, { status: 409 })
    }
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
