'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { fetchMe, type AuthUser } from '@/lib/auth'
import type { Branch, Role, TeamUser } from '@/lib/types'

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export function TeamSection({ branches }: { branches: Branch[] }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [users, setUsers] = useState<TeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createdPin, setCreatedPin] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    pin: randomPin(),
    role: 'CASHIER' as Role,
    branchId: '',
  })

  useEffect(() => {
    fetchMe().then((u) => {
      setAuthUser(u)
      if (u && (u.role === 'OWNER' || u.role === 'MANAGER')) {
        loadUsers()
      } else {
        setLoading(false)
      }
    })
  }, [])

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/users', { cache: 'no-store' })
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error)
      setUsers(data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load team')
    } finally {
      setLoading(false)
    }
  }

  if (!authUser) return null
  if (authUser.role === 'CASHIER') return null

  const branchOptions = authUser.role === 'MANAGER'
    ? branches.filter((b) => b.id === authUser.branchId)
    : branches

  async function handleCreate() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    const branchId = authUser?.role === 'MANAGER' ? authUser.branchId! : form.branchId
    if (!branchId && form.role !== 'OWNER') {
      toast.error('Select a branch')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, branchId }),
      })
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error)
      setUsers((prev) => [...prev, data])
      setCreatedPin(form.pin)
      setForm({ name: '', pin: randomPin(), role: 'CASHIER', branchId: '' })
      setShowCreate(false)
      toast.success(`Created ${data.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user: TeamUser) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !user.active }),
      })
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data : u)))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    }
  }

  async function resetPin(user: TeamUser) {
    const pin = randomPin()
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })
      const { error } = await res.json()
      if (!res.ok) throw new Error(error)
      setCreatedPin(pin)
      toast.success(`PIN reset for ${user.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    }
  }

  return (
    <div className="space-y-6">
      {createdPin && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          PIN (show once): <strong className="font-mono text-lg">{createdPin}</strong>
          <button type="button" onClick={() => setCreatedPin(null)} className="ml-3 text-xs underline">Dismiss</button>
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-800">Team members</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {authUser.role === 'OWNER'
                ? 'Manage managers and cashiers across branches.'
                : 'Manage cashiers in your branch.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowCreate(true); setCreatedPin(null) }}
            className="flex items-center gap-1 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
          >
            <UserPlus size={13} /> Add
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400">No team members yet.</p>
        ) : (
          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3 bg-gray-50">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{user.name}</p>
                  <p className="text-xs text-gray-500">
                    {user.role.toLowerCase()}
                    {user.branch ? ` · ${user.branch.name}` : ''}
                    {!user.active && <span className="text-red-500 ml-1">(inactive)</span>}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button type="button" onClick={() => resetPin(user)} className="text-xs text-blue-600 hover:underline">Reset PIN</button>
                  <button type="button" onClick={() => toggleActive(user)} className="text-xs text-gray-600 hover:underline">
                    {user.active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Add team member</h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            {authUser.role === 'OWNER' && (
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="CASHIER">Cashier</option>
                <option value="MANAGER">Manager</option>
              </select>
            )}
            {authUser.role === 'OWNER' && form.role !== 'OWNER' && (
              <select
                value={form.branchId}
                onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select branch</option>
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.pin}
                onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <button type="button" onClick={() => setForm((f) => ({ ...f, pin: randomPin() }))} className="text-xs text-blue-600 hover:underline shrink-0">
                Regenerate
              </button>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border border-gray-300 py-2 rounded-lg text-sm">Cancel</button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
