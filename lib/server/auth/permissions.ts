import type { Role } from '@prisma/client'
import { prisma } from '@/lib/server/db'
import {
  PERMISSION_KEYS,
  TOGGLABLE_PERMISSIONS,
  PERMISSION_CATALOG,
  isPermissionKey,
  isOwnerOnlyPermission,
  getPermissionMeta,
  type PermissionKey,
} from '@/lib/permissions'
import type { AuthUser } from './guard'

export type { PermissionKey } from '@/lib/permissions'
export {
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  PERMISSION_CATALOG,
  TOGGLABLE_PERMISSIONS,
  isPermissionKey,
  isOwnerOnlyPermission,
} from '@/lib/permissions'

const STAFF_ROLES: Role[] = ['MANAGER', 'CASHIER']

/** Seed or backfill default grants for an organization. */
export async function seedRolePermissions(organizationId: string): Promise<void> {
  const rows = STAFF_ROLES.flatMap((role) =>
    TOGGLABLE_PERMISSIONS.map((p) => ({
      organizationId,
      role,
      permission: p.key,
      granted: p.defaults[role as 'MANAGER' | 'CASHIER'],
    })),
  )

  await prisma.rolePermission.createMany({
    data: rows,
    skipDuplicates: true,
  })
}

async function loadGrantedSet(
  organizationId: string,
  role: Role,
): Promise<Set<PermissionKey>> {
  const rows = await prisma.rolePermission.findMany({
    where: { organizationId, role, granted: true },
    select: { permission: true },
  })
  return new Set(
    rows.map((r) => r.permission).filter((k): k is PermissionKey => isPermissionKey(k)),
  )
}

export async function getEffectivePermissions(user: AuthUser): Promise<Set<PermissionKey>> {
  if (user.role === 'OWNER') {
    return new Set(PERMISSION_KEYS)
  }

  return loadGrantedSet(user.orgId, user.role)
}

export async function hasPermission(
  user: AuthUser,
  key: PermissionKey,
): Promise<boolean> {
  if (user.role === 'OWNER') return true
  if (isOwnerOnlyPermission(key)) return false

  const granted = await loadGrantedSet(user.orgId, user.role)
  return granted.has(key)
}

export async function getPermissionsMatrix(organizationId: string) {
  const rows = await prisma.rolePermission.findMany({
    where: { organizationId, role: { in: STAFF_ROLES } },
  })

  const grants = new Map<string, boolean>()
  for (const row of rows) {
    grants.set(`${row.role}:${row.permission}`, row.granted)
  }

  return {
    catalog: PERMISSION_CATALOG,
    togglable: TOGGLABLE_PERMISSIONS,
    grants: Object.fromEntries(grants),
  }
}

export async function updatePermissionGrants(
  organizationId: string,
  updates: Array<{ role: 'MANAGER' | 'CASHIER'; permission: string; granted: boolean }>,
): Promise<void> {
  for (const { role, permission, granted } of updates) {
    if (!isPermissionKey(permission)) {
      throw new Error(`Unknown permission: ${permission}`)
    }
    const meta = getPermissionMeta(permission)
    if (!meta?.togglable) {
      throw new Error(`Permission is not togglable: ${permission}`)
    }

    await prisma.rolePermission.upsert({
      where: {
        organizationId_role_permission: {
          organizationId,
          role,
          permission,
        },
      },
      create: { organizationId, role, permission, granted },
      update: { granted },
    })
  }
}
