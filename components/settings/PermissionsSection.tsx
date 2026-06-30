'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Shield } from 'lucide-react'
import { toast } from 'sonner'
import {
  PERMISSION_GROUPS,
  type PermissionGroup,
  type PermissionMeta,
} from '@/lib/permissions'

type MatrixData = {
  catalog: PermissionMeta[]
  togglable: PermissionMeta[]
  grants: Record<string, boolean>
}

const ROLES = [
  { id: 'MANAGER' as const, label: 'Manager' },
  { id: 'CASHIER' as const, label: 'Cashier' },
]

function grantKey(role: string, permission: string) {
  return `${role}:${permission}`
}

export function PermissionsSection() {
  const [matrix, setMatrix] = useState<MatrixData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/permissions', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load permissions')
      const { data, error } = await res.json()
      if (error) throw new Error(error)
      setMatrix(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggle(role: 'MANAGER' | 'CASHIER', permission: string, granted: boolean) {
    const key = grantKey(role, permission)
    setSaving(key)
    try {
      const res = await fetch('/api/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ role, permission, granted }] }),
      })
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error ?? 'Update failed')
      setMatrix(data)
      toast.success('Permission updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading permissions…
      </div>
    )
  }

  if (!matrix) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Could not load permissions.
      </p>
    )
  }

  const byGroup = matrix.togglable.reduce<Record<PermissionGroup, PermissionMeta[]>>(
    (acc, p) => {
      acc[p.group] = acc[p.group] ?? []
      acc[p.group].push(p)
      return acc
    },
    {} as Record<PermissionGroup, PermissionMeta[]>,
  )

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Roles &amp; Permissions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toggle capabilities for managers and cashiers. You always have full access; owner-only
          actions (store settings, branches, cost/floor prices) are not listed here.
        </p>
      </div>

      {(Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => {
        const items = byGroup[group]
        if (!items?.length) return null
        return (
          <section key={group} className="rounded-lg border bg-card">
            <h3 className="border-b px-4 py-3 text-sm font-medium text-muted-foreground">
              {PERMISSION_GROUPS[group]}
            </h3>
            <div className="divide-y">
              {items.map((perm) => (
                <div
                  key={perm.key}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 sm:grid-cols-[1fr_6rem_6rem]"
                >
                  <div>
                    <p className="text-sm font-medium">{perm.label}</p>
                    <p className="text-xs text-muted-foreground">{perm.key}</p>
                  </div>
                  {ROLES.map((role) => {
                    const gk = grantKey(role.id, perm.key)
                    const checked = matrix.grants[gk] ?? perm.defaults[role.id]
                    const busy = saving === gk
                    return (
                      <label
                        key={role.id}
                        className="flex flex-col items-center gap-1 text-xs text-muted-foreground"
                      >
                        <span className="hidden sm:inline">{role.label}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          disabled={busy}
                          onClick={() => toggle(role.id, perm.key, !checked)}
                          className={`relative h-6 w-11 rounded-full transition-colors ${
                            checked ? 'bg-primary' : 'bg-muted'
                          } ${busy ? 'opacity-50' : ''}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              checked ? 'translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
