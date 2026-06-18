'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

type Props = {
  brands: string[]
  counts: Record<string, number>
  value: string
  onChange: (brand: string) => void
}

export function BrandPicker({ brands, counts, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(
    () => [...brands].sort((a, b) => a.localeCompare(b)),
    [brands],
  )

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((b) => b.toLowerCase().includes(q))
  }, [sorted, filter])

  const label = value === 'all' ? 'All brands' : value

  const count = value === 'all' ? counts.all ?? 0 : counts[value] ?? 0

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function pick(brand: string) {
    onChange(brand)
    setOpen(false)
    setFilter('')
  }

  return (
    <div ref={rootRef} className="relative w-full min-w-0 sm:w-52 lg:w-60 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className="flex-1 text-left truncate font-medium text-gray-800">{label}</span>
        <span className="text-xs tabular-nums text-gray-400 shrink-0">{count.toLocaleString()}</span>
        <ChevronDown size={15} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-30 mt-1 rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter brands…"
                className="w-full rounded-lg border border-gray-200 pl-8 pr-8 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {filter && (
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <ul className="max-h-64 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => pick('all')}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 ${value === 'all' ? 'bg-blue-50 text-blue-700' : 'text-gray-800'}`}
              >
                <span className="flex-1 truncate font-medium">All brands</span>
                <span className="text-xs text-gray-400 tabular-nums">{(counts.all ?? 0).toLocaleString()}</span>
                {value === 'all' && <Check size={14} className="text-blue-600 shrink-0" />}
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-4 text-xs text-gray-500 text-center">No brands match</li>
            ) : (
              filtered.map((brand) => (
                <li key={brand}>
                  <button
                    type="button"
                    onClick={() => pick(brand)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 ${value === brand ? 'bg-blue-50 text-blue-700' : 'text-gray-800'}`}
                  >
                    <span className="flex-1 truncate">{brand}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{(counts[brand] ?? 0).toLocaleString()}</span>
                    {value === brand && <Check size={14} className="text-blue-600 shrink-0" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
