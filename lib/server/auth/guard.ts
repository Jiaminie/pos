import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { hasPermission, type PermissionKey } from './permissions'
import { readSession, type SessionPayload } from './session'

export type AuthUser = SessionPayload

type GuardOptions = {
  roles?: Role[]
}

export function jsonError(message: string, status: number) {
  return Response.json({ data: null, error: message }, { status })
}

export async function requireUser(
  _request?: NextRequest,
  opts?: GuardOptions,
): Promise<AuthUser | Response> {
  const session = await readSession()
  if (!session) return jsonError('Unauthorized', 401)

  if (opts?.roles && !opts.roles.includes(session.role)) {
    return jsonError('Forbidden', 403)
  }

  return session
}

export function isAuthUser(result: AuthUser | Response): result is AuthUser {
  return !(result instanceof Response)
}

/** Branch filter for DB queries — owners see all unless narrowed by activeBranchId. */
export function branchFilter(
  user: AuthUser,
  requestedBranchId?: string | null,
): { branchId?: string } | Record<string, never> {
  if (user.role === 'OWNER') {
    if (requestedBranchId) return { branchId: requestedBranchId }
    if (user.branchId) return { branchId: user.branchId }
    return {}
  }
  return { branchId: user.branchId ?? undefined }
}

export function assertBranchAccess(user: AuthUser, branchId: string): Response | null {
  if (user.role === 'OWNER') return null
  if (user.branchId !== branchId) {
    return jsonError('Forbidden — branch mismatch', 403)
  }
  return null
}

/** Whether this user may sync/write transactions for the given branch. */
export function canAccessBranch(user: AuthUser, branchId: string | null | undefined): boolean {
  if (!branchId) return true
  if (user.role === 'OWNER') return true
  return user.branchId === branchId
}

export async function requirePermission(
  user: AuthUser,
  permission: PermissionKey,
): Promise<AuthUser | Response> {
  const allowed = await hasPermission(user, permission)
  if (!allowed) return jsonError('Forbidden', 403)
  return user
}

export async function requireUserWithPermission(
  request: NextRequest | undefined,
  permission: PermissionKey,
): Promise<AuthUser | Response> {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user
  return requirePermission(user, permission)
}

export async function canManageUsers(user: AuthUser): Promise<boolean> {
  if (user.role === 'OWNER') return true
  return hasPermission(user, 'users.manage.cashiers')
}
