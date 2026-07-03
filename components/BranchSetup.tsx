'use client'

import { useEffect, useState } from 'react'
import { Building2, ChevronDown, Loader2, MapPin, Monitor, Smartphone, Star, Tablet } from 'lucide-react'
import { setMyBranchId, setMyOrgId } from '@/lib/branch'
import {
  DEVICE_UI_MODES,
  getDeviceUiMode,
  setDeviceUiMode,
  type DeviceUiMode,
} from '@/lib/device-ui'
import type { Branch } from '@/lib/types'

const MODE_ICONS: Record<DeviceUiMode, typeof Monitor> = {
  desktop: Monitor,
  touch: Tablet,
  mobile: Smartphone,
}

interface Props {
  onComplete: () => void
}

export function BranchSetup({ onComplete }: Props) {
  const [branches, setBranches]     = useState<Branch[]>([])
  const [loading, setLoading]       = useState(true)
  const [selecting, setSelecting]   = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [uiMode, setUiMode]         = useState<DeviceUiMode>('desktop')
  const [uiMenuOpen, setUiMenuOpen] = useState(false)

  useEffect(() => {
    setUiMode(getDeviceUiMode())
  }, [])

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
    setDeviceUiMode(uiMode)
    document.documentElement.setAttribute('data-ui-mode', uiMode)
    setMyBranchId(branch.id)
    setMyOrgId(branch.organizationId)
    onComplete()
  }

  const selectedMode = DEVICE_UI_MODES.find((m) => m.value === uiMode) ?? DEVICE_UI_MODES[0]
  const SelectedIcon = MODE_ICONS[uiMode]

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Select your branch</h1>
          <p className="text-sm text-gray-500 mt-1">
            Choose how this device is used and which branch it belongs to.
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Device UI mode</label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setUiMenuOpen((o) => !o)}
              className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left hover:border-blue-400 transition-colors"
            >
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 text-blue-600 shrink-0">
                <SelectedIcon size={18} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900">{selectedMode.label}</span>
                <span className="block text-xs text-gray-500 truncate">{selectedMode.description}</span>
              </span>
              <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${uiMenuOpen ? 'rotate-180' : ''}`} />
            </button>
            {uiMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setUiMenuOpen(false)} aria-hidden />
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                  {DEVICE_UI_MODES.map((mode) => {
                    const Icon = MODE_ICONS[mode.value]
                    const active = mode.value === uiMode
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => { setUiMode(mode.value); setUiMenuOpen(false) }}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors ${
                          active ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${active ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-sm font-medium ${active ? 'text-blue-800' : 'text-gray-900'}`}>{mode.label}</span>
                          <span className="block text-xs text-gray-500 leading-snug">{mode.description}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
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
                  <Loader2 size={16} className="animate-spin text-blue-600 shrink-0 mt-0.5" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
