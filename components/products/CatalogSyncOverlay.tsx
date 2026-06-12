'use client'

import { useEffect, useState } from 'react'
import { Check, CloudDownload, Database, FolderOpen, Loader2, Package } from 'lucide-react'
import type { CatalogSyncProgress } from '@/lib/db/sync-progress'
import { SYNC_TIPS } from '@/lib/db/sync-progress'

type Props = {
  open: boolean
  progress: CatalogSyncProgress | null
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function progressPercent(p: CatalogSyncProgress): number {
  if (p.phase === 'done') return 100
  if (p.phase === 'write') return p.totalProducts ? 92 : 85
  if (p.phase === 'categories') return 8
  if (p.totalProducts && p.totalProducts > 0) {
    const dl = Math.min(88, Math.round((p.productsLoaded / p.totalProducts) * 88))
    return Math.max(10, dl)
  }
  // Unknown total — gentle pulse based on batches
  return Math.min(85, 10 + p.batchIndex * 4)
}

const STEPS = [
  { key: 'categories', label: 'Categories', icon: FolderOpen },
  { key: 'download', label: 'Download', icon: CloudDownload },
  { key: 'write', label: 'Save locally', icon: Database },
] as const

export function CatalogSyncOverlay({ open, progress }: Props) {
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setTipIndex((i) => (i + 1) % SYNC_TIPS.length), 4500)
    return () => clearInterval(id)
  }, [open])

  if (!open || !progress) return null

  const pct = progressPercent(progress)
  const stepIndex =
    progress.phase === 'categories' ? 0
    : progress.phase === 'download' ? 1
    : progress.phase === 'write' || progress.phase === 'done' ? 2
    : 1

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />

      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Animated header strip */}
        <div className="h-1.5 bg-gray-100 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-start gap-4">
            <div className="relative shrink-0">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center">
                {progress.phase === 'done' ? (
                  <Check size={28} className="text-green-600" />
                ) : progress.phase === 'error' ? (
                  <Package size={28} className="text-red-500" />
                ) : (
                  <Package size={28} className="text-blue-600" />
                )}
              </div>
              {progress.phase !== 'done' && progress.phase !== 'error' && (
                <Loader2
                  size={18}
                  className="absolute -bottom-1 -right-1 text-blue-600 animate-spin bg-white rounded-full"
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-gray-900">
                {progress.phase === 'done' ? 'Catalog synced' : 'Syncing your catalog'}
              </h2>
              <p className="text-sm text-gray-600 mt-0.5">{progress.message}</p>
              {progress.elapsedMs > 0 && (
                <p className="text-xs text-gray-400 mt-1">Elapsed: {formatElapsed(progress.elapsedMs)}</p>
              )}
            </div>
          </div>

          {/* Live counter */}
          {progress.productsLoaded > 0 && (
            <div className="rounded-xl bg-gradient-to-br from-slate-50 to-blue-50 border border-blue-100 px-4 py-3 text-center">
              <p className="text-3xl font-bold tabular-nums text-gray-900 tracking-tight">
                {progress.productsLoaded.toLocaleString()}
                {progress.totalProducts != null && (
                  <span className="text-lg font-medium text-gray-400">
                    {' '}/ {progress.totalProducts.toLocaleString()}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">products loaded</p>
            </div>
          )}

          {/* Step pipeline */}
          <div className="flex items-center justify-between gap-1">
            {STEPS.map((step, i) => {
              const Icon = step.icon
              const done = i < stepIndex || progress.phase === 'done'
              const active = i === stepIndex && progress.phase !== 'done' && progress.phase !== 'error'
              return (
                <div key={step.key} className="flex-1 flex flex-col items-center gap-1.5">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                      done
                        ? 'bg-green-100 text-green-700'
                        : active
                          ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300 ring-offset-2'
                          : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {done ? <Check size={16} /> : <Icon size={16} className={active ? 'animate-pulse' : ''} />}
                  </div>
                  <span className={`text-[10px] font-medium ${active ? 'text-blue-700' : 'text-gray-500'}`}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Product name ticker */}
          {progress.recentNames.length > 0 && progress.phase === 'download' && (
            <div className="overflow-hidden rounded-lg bg-gray-950 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Just received</p>
              <div className="space-y-0.5">
                {progress.recentNames.map((name, i) => (
                  <p
                    key={`${name}-${i}`}
                    className="text-xs text-gray-300 truncate"
                  >
                    {name}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Rotating tip */}
          {progress.phase !== 'done' && progress.phase !== 'error' && (
            <p key={tipIndex} className="text-xs text-center text-gray-500 leading-relaxed transition-opacity">
              {SYNC_TIPS[tipIndex]}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
