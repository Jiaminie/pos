'use client'

import { useEffect, useRef, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, Loader2, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { fetchMe, type AuthUser } from '@/lib/auth'
import type { Branch, Role, TeamUser } from '@/lib/types'

type PendingTeamUser = TeamUser & { pending?: boolean }
type EditForm = { name: string; role: Role; branchId: string }
const EMPTY_EDIT_FORM: EditForm = { name: '', role: 'CASHIER', branchId: '' }

function randomPin(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export function TeamSection({ branches }: { branches: Branch[] }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [users, setUsers] = useState<PendingTeamUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createdPin, setCreatedPin] = useState<string | null>(null)
  const creating = useRef(false)
  const [form, setForm] = useState({
    name: '',
    pin: randomPin(),
    role: 'CASHIER' as Role,
    branchId: '',
  })
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>(EMPTY_EDIT_FORM)
  const [userSaving, setUserSaving] = useState(false)
  const [userDeletingId, setUserDeletingId] = useState<string | null>(null)

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

  function handleCreate() {
    if (creating.current) return
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    const branchId = authUser?.role === 'MANAGER' ? authUser.branchId! : form.branchId
    if (!branchId && form.role !== 'OWNER') {
      toast.error('Select a branch')
      return
    }
    creating.current = true

    const tempId = `pending-${crypto.randomUUID()}`
    const branchInfo = branches.find((b) => b.id === branchId) ?? null
    const optimistic: PendingTeamUser = {
      id: tempId,
      name: form.name.trim(),
      role: form.role,
      branchId: branchId || null,
      active: true,
      branch: branchInfo ? { id: branchInfo.id, name: branchInfo.name, code: branchInfo.code } : null,
      pending: true,
    }
    const pinToShow = form.pin
    setUsers((prev) => [...prev, optimistic])
    setForm({ name: '', pin: randomPin(), role: 'CASHIER', branchId: '' })
    setShowCreate(false)

    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, branchId }),
    }).then(async (res) => {
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error)
      setUsers((prev) => prev.map((u) => u.id === tempId ? data : u))
      setCreatedPin(pinToShow)
      toast.success(`Created ${data.name}`)
    }).catch((err) => {
      setUsers((prev) => prev.filter((u) => u.id !== tempId))
      toast.error(err instanceof Error ? err.message : 'Create failed')
    }).finally(() => {
      creating.current = false
    })
  }

  function toggleActive(user: PendingTeamUser) {
    if (user.pending) { toast.error('Still syncing — try again in a moment'); return }
    const prevUsers = users
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, active: !u.active } : u)))

    fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !user.active }),
    }).then(async (res) => {
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? data : u)))
    }).catch((err) => {
      setUsers(prevUsers)
      toast.error(err instanceof Error ? err.message : 'Update failed — reverted')
    })
  }

  function resetPin(user: PendingTeamUser) {
    if (user.pending) { toast.error('Still syncing — try again in a moment'); return }
    const pin = randomPin()
    setCreatedPin(pin)
    toast.success(`PIN reset for ${user.name}`)

    fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }).then(async (res) => {
      const { error } = await res.json()
      if (!res.ok) throw new Error(error)
    }).catch((err) => {
      setCreatedPin(null)
      toast.error(err instanceof Error ? err.message : 'PIN reset failed — the old PIN is still active')
    })
  }

  function canEditUser(user: PendingTeamUser): boolean {
    if (user.pending || user.role === 'OWNER') return false
    if (authUser?.role === 'MANAGER') {
      return user.role === 'CASHIER' && user.branchId === authUser.branchId
    }
    return authUser?.role === 'OWNER'
  }

  function canDeleteUser(user: PendingTeamUser): boolean {
    if (user.pending || user.role === 'OWNER' || user.id === authUser?.userId) return false
    if (authUser?.role === 'MANAGER') {
      return user.role === 'CASHIER' && user.branchId === authUser.branchId
    }
    return authUser?.role === 'OWNER'
  }

  function startEditUser(user: PendingTeamUser) {
    if (!canEditUser(user)) return
    setEditingUserId(user.id)
    setEditForm({
      name: user.name,
      role: user.role,
      branchId: user.branchId ?? '',
    })
  }

  function cancelEditUser() {
    setEditingUserId(null)
    setEditForm(EMPTY_EDIT_FORM)
  }

  async function handleUpdateUser() {
    if (!editingUserId || userSaving) return
    if (!editForm.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (authUser?.role === 'OWNER' && editForm.role !== 'OWNER' && !editForm.branchId) {
      toast.error('Select a branch')
      return
    }

    const prevUsers = users
    const snapshot = editForm
    const branchInfo = branches.find((b) => b.id === snapshot.branchId) ?? null
    setUserSaving(true)
    setUsers((prev) => prev.map((u) =>
      u.id === editingUserId
        ? {
            ...u,
            name: snapshot.name.trim(),
            role: snapshot.role,
            branchId: snapshot.branchId || null,
            branch: branchInfo ? { id: branchInfo.id, name: branchInfo.name, code: branchInfo.code } : null,
          }
        : u,
    ))

    try {
      const body: Record<string, string> = { name: snapshot.name.trim() }
      if (authUser?.role === 'OWNER') {
        body.role = snapshot.role
        if (snapshot.role !== 'OWNER') body.branchId = snapshot.branchId
      }

      const res = await fetch(`/api/users/${editingUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const { data, error } = await res.json()
      if (!res.ok) throw new Error(error ?? 'Failed to update team member')
      setUsers((prev) => prev.map((u) => (u.id === editingUserId ? data : u)))
      cancelEditUser()
      toast.success(`Updated ${data.name}`)
    } catch (err) {
      setUsers(prevUsers)
      toast.error(err instanceof Error ? err.message : 'Failed to update team member')
    } finally {
      setUserSaving(false)
    }
  }

  async function handleDeleteUser(user: PendingTeamUser) {
    if (!canDeleteUser(user)) return
    if (!window.confirm(`Delete team member "${user.name}"? This cannot be undone.`)) return

    const prevUsers = users
    setUserDeletingId(user.id)
    setUsers((prev) => prev.filter((u) => u.id !== user.id))
    if (editingUserId === user.id) cancelEditUser()

    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
      const { error } = await res.json()
      if (!res.ok) throw new Error(error ?? 'Failed to delete team member')
      toast.success(`Deleted ${user.name}`)
    } catch (err) {
      setUsers(prevUsers)
      toast.error(err instanceof Error ? err.message : 'Failed to delete team member')
    } finally {
      setUserDeletingId(null)
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
              <div key={user.id} className="border border-gray-100 rounded-xl px-4 py-3 bg-gray-50">
                {editingUserId === user.id ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-gray-700">Full name</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {authUser.role === 'OWNER' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-700">Role</label>
                        <Select.Root
                          value={editForm.role}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, role: v as Role }))}
                        >
                          <Select.Trigger className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <Select.Value />
                            <Select.Icon><ChevronDown size={14} className="text-gray-400" /></Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content
                              className="z-[60] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                              position="popper"
                              sideOffset={4}
                            >
                              <Select.Viewport className="p-1">
                                <Select.Item value="CASHIER" className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50">
                                  <Select.ItemText>Cashier</Select.ItemText>
                                </Select.Item>
                                <Select.Item value="MANAGER" className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50">
                                  <Select.ItemText>Manager</Select.ItemText>
                                </Select.Item>
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </div>
                    )}
                    {authUser.role === 'OWNER' && editForm.role !== 'OWNER' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-medium text-gray-700">Branch</label>
                        <Select.Root
                          value={editForm.branchId}
                          onValueChange={(v) => setEditForm((f) => ({ ...f, branchId: v }))}
                        >
                          <Select.Trigger className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <Select.Value placeholder="Select branch" />
                            <Select.Icon><ChevronDown size={14} className="text-gray-400" /></Select.Icon>
                          </Select.Trigger>
                          <Select.Portal>
                            <Select.Content
                              className="z-[60] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                              position="popper"
                              sideOffset={4}
                            >
                              <Select.Viewport className="p-1">
                                {branchOptions.map((b) => (
                                  <Select.Item
                                    key={b.id}
                                    value={b.id}
                                    className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50"
                                  >
                                    <Select.ItemText>
                                      {b.name}{' '}
                                      <span className="text-xs text-gray-500 font-mono">({b.code})</span>
                                    </Select.ItemText>
                                  </Select.Item>
                                ))}
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleUpdateUser}
                        disabled={userSaving}
                        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                      >
                        {userSaving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditUser}
                        disabled={userSaving}
                        className="flex items-center gap-1.5 border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors disabled:opacity-60"
                      >
                        <X size={13} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{user.name}</p>
                      <p className="text-xs text-gray-500">
                        {user.role.toLowerCase()}
                        {user.branch ? ` · ${user.branch.name}` : ''}
                        {!user.active && <span className="text-red-500 ml-1">(inactive)</span>}
                        {user.pending && <span className="text-gray-400 ml-1">(syncing…)</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" disabled={user.pending} onClick={() => resetPin(user)} className="text-xs text-blue-600 hover:underline disabled:opacity-40 disabled:no-underline px-1">Reset PIN</button>
                      <button type="button" disabled={user.pending} onClick={() => toggleActive(user)} className="text-xs text-gray-600 hover:underline disabled:opacity-40 disabled:no-underline px-1">
                        {user.active ? 'Deactivate' : 'Activate'}
                      </button>
                      {canEditUser(user) && (
                        <button
                          type="button"
                          onClick={() => startEditUser(user)}
                          title="Edit team member"
                          aria-label="Edit team member"
                          className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      {canDeleteUser(user) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(user)}
                          disabled={userDeletingId === user.id}
                          title="Delete team member"
                          aria-label="Delete team member"
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                        >
                          {userDeletingId === user.id
                            ? <Loader2 size={14} className="animate-spin" />
                            : <Trash2 size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">Add team member</h3>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-700">Full name</label>
              <input
                type="text"
                placeholder="e.g. Jane Wanjiku"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {authUser.role === 'OWNER' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">Role</label>
                <Select.Root
                  value={form.role}
                  onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
                >
                  <Select.Trigger className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <Select.Value />
                    <Select.Icon><ChevronDown size={14} className="text-gray-400" /></Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content
                      className="z-[60] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                      position="popper"
                      sideOffset={4}
                    >
                      <Select.Viewport className="p-1">
                        <Select.Item
                          value="CASHIER"
                          className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50"
                        >
                          <Select.ItemText>Cashier</Select.ItemText>
                        </Select.Item>
                        <Select.Item
                          value="MANAGER"
                          className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50"
                        >
                          <Select.ItemText>Manager</Select.ItemText>
                        </Select.Item>
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>
            )}
            {authUser.role === 'OWNER' && form.role !== 'OWNER' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-gray-700">Branch</label>
                <Select.Root
                  value={form.branchId}
                  onValueChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
                >
                  <Select.Trigger className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <Select.Value placeholder="Select branch" />
                    <Select.Icon><ChevronDown size={14} className="text-gray-400" /></Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content
                      className="z-[60] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden"
                      position="popper"
                      sideOffset={4}
                    >
                      <Select.Viewport className="p-1">
                        {branchOptions.map((b) => (
                          <Select.Item
                            key={b.id}
                            value={b.id}
                            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50"
                          >
                            <Select.ItemText>
                              {b.name}{' '}
                              <span className="text-xs text-gray-500 font-mono">({b.code})</span>
                            </Select.ItemText>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-700">PIN</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={form.pin}
                  onChange={(e) => setForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button type="button" onClick={() => setForm((f) => ({ ...f, pin: randomPin() }))} className="text-xs text-blue-600 hover:underline shrink-0">
                  Regenerate
                </button>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border border-gray-300 py-2 rounded-lg text-sm">Cancel</button>
            <button
              type="button"
              onClick={handleCreate}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Plus size={14} />
              Create
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
