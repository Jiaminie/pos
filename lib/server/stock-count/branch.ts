import type { AuthUser } from '@/lib/server/auth/guard'

/** Mirrors branchFilter's convention (lib/server/auth/guard.ts): only OWNER may
 *  override branchId with a client-supplied value — everyone else is pinned to
 *  their own branch, regardless of what the request asks for. Callers should
 *  still pair this with assertBranchAccess for the OWNER-supplied-a-foreign-id case. */
export function resolveStockCountBranchId(
  requestBranchId: string | undefined | null,
  user: AuthUser,
): string | null {
  if (user.role !== 'OWNER') return user.branchId
  return requestBranchId ?? user.branchId
}
