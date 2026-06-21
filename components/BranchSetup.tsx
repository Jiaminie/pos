'use client'

import { useEffect, useState } from 'react'
import { Building2, Check, Loader2, MapPin, Star } from 'lucide-react'
import { setMyBranchId, setMyOrgId } from '@/lib/branch'
import { replaceCatalogFromServer } from '@/lib/db/seed'
import type { Branch } from '@/lib/types'

interface Props {
  onComplete: () => void
}

export function BranchSetup({ onComplete }: Props) {
  const [branches, setBranches]     = useState<Branch[]>([])
  const [loading, setLoading]       = useState(true)
  const [selecting, setSelecting]   = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [syncing, setSyncing]       = useState(false)

  useEffect(() => {
    fetch('/api/branches', { cache: 'no-store' })
      .then((r) => r.json())
      .then(({ data, error: e }) => {
        if (e || !data) { setError(e ?? 'Could not load branches'); return }
        setBranches(data as Branch[])
      })
      .catch(() => setError('Could not reach server'))
      .finally(() => setLoading(false))
  }, [])

  async function selectBranch(branch: Branch) {
    setSelecting(branch.id)
    setMyBranchId(branch.id)
    setMyOrgId(branch.organizationId)
    setSyncing(true)
    await replaceCatalogFromServer()
    setSyncing(false)
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Select your branch</h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose the branch this device belongs to. All sales and stock will be recorded here.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-8">
            <Loader2 size={16} className="animate-spin" />
            Loading branches…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 text-center">
            {error}
            <button
              className="block mx-auto mt-2 text-red-600 underline text-xs"
              onClick={() => { setError(null); setLoading(true); window.location.reload() }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && branches.length === 0 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-4 text-sm text-amber-800 text-center">
            No branches have been set up yet.
            <p className="text-xs mt-1 text-amber-700">
              Ask your administrator to create branches in Settings, then come back.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {branches.map((branch) => {
            const isSelecting = selecting === branch.id
            return (
              <button
                key={branch.id}
                type="button"
                disabled={!!selecting}
                onClick={() => selectBranch(branch)}
                className={`w-full text-left rounded-xl border px-4 py-3.5 transition-colors flex items-start justify-between gap-3 ${
                  isSelecting
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50/40'
                } disabled:opacity-60`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900">{branch.name}</span>
                    <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      {branch.code}
                    </span>
                    {branch.isPrimary && (
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                        <Star size={10} className="fill-amber-400 text-amber-400" />
                        Primary
                      </span>
                    )}
                  </div>
                  {branch.address && (
                    <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                      <MapPin size={10} />
                      {branch.address}
                    </p>
                  )}
                </div>
                {isSelecting ? (
                  syncing
                    ? <Loader2 size={16} className="animate-spin text-blue-600 shrink-0 mt-0.5" />
                    : <Check size={16} className="text-blue-600 shrink-0 mt-0.5" />
                ) : null}
              </button>
            )
          })}
        </div>

        {syncing && (
          <p className="text-center text-xs text-blue-600 mt-4">
            Syncing catalog to this device…
          </p>
        )}
      </div>
    </div>
  )
}
