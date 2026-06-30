'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
      <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
        <Loader2 size={14} className="animate-spin" />
        Loading permissions…
      </div>
    )
  }

  if (!matrix) {
    return (
      <p className="text-sm text-gray-400 py-4">
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
    <div className="space-y-6">
      <section className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-5">
        <p className="text-xs text-blue-900/80 leading-relaxed">
          Toggle capabilities for managers and cashiers. You always have full access; owner-only
          actions (store settings, branches, cost/floor prices) are not listed here.
        </p>
      </section>

      {(Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => {
        const items = byGroup[group]
        if (!items?.length) return null
        return (
          <section key={group} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-800">{PERMISSION_GROUPS[group]}</h3>
            </div>

            <div className="hidden sm:grid sm:grid-cols-[1fr_5.5rem_5.5rem] gap-4 px-5 py-2 border-b border-gray-100">
              <span />
              {ROLES.map((role) => (
                <span key={role.id} className="text-center text-xs font-medium text-gray-500">
                  {role.label}
                </span>
              ))}
            </div>

            <div className="divide-y divide-gray-100">
              {items.map((perm) => (
                <div
                  key={perm.key}
                  className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_5.5rem_5.5rem] items-center gap-x-4 gap-y-2 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{perm.label}</p>
                    <p className="text-[11px] font-mono text-gray-400 mt-0.5">{perm.key}</p>
                  </div>
                  {ROLES.map((role) => {
                    const gk = grantKey(role.id, perm.key)
                    const checked = matrix.grants[gk] ?? perm.defaults[role.id]
                    const busy = saving === gk
                    return (
                      <div
                        key={role.id}
                        className="flex flex-col items-center gap-1.5 sm:gap-0"
                      >
                        <span className="sm:hidden text-[10px] font-medium text-gray-500">
                          {role.label}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          aria-label={`${role.label}: ${perm.label}`}
                          disabled={busy}
                          onClick={() => toggle(role.id, perm.key, !checked)}
                          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                            checked
                              ? 'border-blue-600 bg-blue-600'
                              : 'border-gray-300 bg-gray-200'
                          } ${busy ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                        >
                          <span
                            className={`pointer-events-none absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                              checked ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
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
