import { getPermissionMeta, isPermissionKey, type PermissionKey as CatalogPermissionKey } from './permissions'

const AUTH_CACHE_KEY = 'pos_auth_user'

export type PermissionKey = string

export type AuthUser = {
  userId: string
  name: string
  role: 'OWNER' | 'MANAGER' | 'CASHIER'
  branchId: string | null
  orgId: string
  permissions?: PermissionKey[]
}

export function cacheAuthUser(user: AuthUser): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user))
}

export function getCachedAuthUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function clearCachedAuthUser(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(AUTH_CACHE_KEY)
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' })
    if (!res.ok) return null
    const { data } = await res.json()
    if (data) cacheAuthUser(data)
    return data
  } catch {
    return getCachedAuthUser()
  }
}

export async function login(pin: string, branchId: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, branchId }),
  })
  const { data, error } = await res.json()
  if (!res.ok) throw new Error(error ?? 'Login failed')
  cacheAuthUser(data)
  return data
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
  clearCachedAuthUser()
}

export function canManageTeam(user: AuthUser): boolean {
  if (user.role === 'OWNER') return true
  return hasPermission(user, 'users.manage.cashiers')
}

export function canViewReports(user: AuthUser): boolean {
  if (user.role === 'OWNER') return true
  return (
    hasPermission(user, 'reports.view.org') ||
    hasPermission(user, 'reports.view.branch') ||
    hasPermission(user, 'reports.view.own')
  )
}


export function hasPermission(user: AuthUser | null, key: PermissionKey): boolean {
  if (!user) return false
  if (user.role === 'OWNER') return true
  if (user.permissions?.includes(key)) return true
  // Legacy sessions cached before login included permissions — match server defaults.
  if (!user.permissions && isPermissionKey(key)) {
    const meta = getPermissionMeta(key as CatalogPermissionKey)
    if (meta?.togglable && (user.role === 'MANAGER' || user.role === 'CASHIER')) {
      return meta.defaults[user.role]
    }
  }
  return false
}
