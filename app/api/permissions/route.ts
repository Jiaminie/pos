import { NextRequest } from 'next/server'
import { requireUser, isAuthUser, requirePermission } from '@/lib/server/auth/guard'
import {
  getPermissionsMatrix,
  updatePermissionGrants,
} from '@/lib/server/auth/permissions'
import { logAudit } from '@/lib/server/audit'

export async function GET() {
  const user = await requireUser()
  if (!isAuthUser(user)) return user

  const denied = await requirePermission(user, 'admin.permissions.configure')
  if (!isAuthUser(denied)) return denied

  const matrix = await getPermissionsMatrix(user.orgId)
  return Response.json({ data: matrix, error: null })
}

export async function PUT(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  const denied = await requirePermission(user, 'admin.permissions.configure')
  if (!isAuthUser(denied)) return denied

  try {
    const body = await request.json()
    const updates = body.updates as Array<{
      role: 'MANAGER' | 'CASHIER'
      permission: string
      granted: boolean
    }>

    if (!Array.isArray(updates) || updates.length === 0) {
      return Response.json(
        { data: null, error: 'updates array is required' },
        { status: 400 },
      )
    }

    await updatePermissionGrants(user.orgId, updates)
    await logAudit({
      organizationId: user.orgId,
      actorId: user.userId,
      actorName: user.name,
      action: 'PERMISSION_CHANGE',
      targetType: 'RolePermission',
      metadata: { updates },
    })
    const matrix = await getPermissionsMatrix(user.orgId)
    return Response.json({ data: matrix, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 400 })
  }
}
