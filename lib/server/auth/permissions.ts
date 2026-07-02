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
type StaffRole = 'MANAGER' | 'CASHIER'

/** Seed or backfill default grants for an organization. */
export async function seedRolePermissions(organizationId: string): Promise<void> {
  const rows = STAFF_ROLES.flatMap((role) =>
    TOGGLABLE_PERMISSIONS.map((p) => ({
      organizationId,
      role,
      permission: p.key,
      granted: p.defaults[role as StaffRole],
    })),
  )

  await prisma.rolePermission.createMany({
    data: rows,
    skipDuplicates: true,
  })
}

async function ensureSeeded(organizationId: string): Promise<void> {
  const count = await prisma.rolePermission.count({ where: { organizationId } })
  if (count === 0) await seedRolePermissions(organizationId)
}

/** Match the Settings UI: explicit DB row wins, else catalog default. */
function resolveGrant(
  dbGrants: Map<string, boolean>,
  role: StaffRole,
  permission: PermissionKey,
): boolean {
  const stored = dbGrants.get(permission)
  if (stored !== undefined) return stored
  return getPermissionMeta(permission)?.defaults[role] ?? false
}

async function loadDbGrants(organizationId: string, role: Role): Promise<Map<string, boolean>> {
  await ensureSeeded(organizationId)
  const rows = await prisma.rolePermission.findMany({
    where: { organizationId, role },
    select: { permission: true, granted: true },
  })
  return new Map(rows.map((r) => [r.permission, r.granted]))
}

async function getEffectiveGrantsForRole(
  organizationId: string,
  role: Role,
): Promise<Set<PermissionKey>> {
  if (role === 'OWNER') return new Set(PERMISSION_KEYS)

  const dbGrants = await loadDbGrants(organizationId, role)
  const staffRole = role as StaffRole
  const effective = new Set<PermissionKey>()
  for (const p of TOGGLABLE_PERMISSIONS) {
    if (resolveGrant(dbGrants, staffRole, p.key)) effective.add(p.key)
  }
  return effective
}

export async function getEffectivePermissions(user: AuthUser): Promise<Set<PermissionKey>> {
  if (user.role === 'OWNER') {
    return new Set(PERMISSION_KEYS)
  }

  return getEffectiveGrantsForRole(user.orgId, user.role)
}

export async function hasPermission(
  user: AuthUser,
  key: PermissionKey,
): Promise<boolean> {
  if (user.role === 'OWNER') return true
  if (isOwnerOnlyPermission(key)) return false

  const granted = await getEffectiveGrantsForRole(user.orgId, user.role)
  return granted.has(key)
}

export async function getPermissionsMatrix(organizationId: string) {
  await ensureSeeded(organizationId)

  const rows = await prisma.rolePermission.findMany({
    where: { organizationId, role: { in: STAFF_ROLES } },
  })

  const dbGrants = new Map<string, boolean>()
  for (const row of rows) {
    dbGrants.set(`${row.role}:${row.permission}`, row.granted)
  }

  const grants: Record<string, boolean> = {}
  for (const role of STAFF_ROLES) {
    for (const p of TOGGLABLE_PERMISSIONS) {
      const key = `${role}:${p.key}`
      const stored = dbGrants.get(key)
      grants[key] =
        stored !== undefined ? stored : p.defaults[role as StaffRole]
    }
  }

  return {
    catalog: PERMISSION_CATALOG,
    togglable: TOGGLABLE_PERMISSIONS,
    grants,
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
