'use client'

import { Delete } from 'lucide-react'
import { isTouchOptimized, type DeviceUiMode } from '@/lib/device-ui'

type QtyNumpadProps = {
  value: string
  onChange: (value: string) => void
  deviceUiMode: DeviceUiMode
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const

export function QtyNumpad({ value, onChange, deviceUiMode }: QtyNumpadProps) {
  const touch = isTouchOptimized(deviceUiMode)

  function press(key: (typeof KEYS)[number]) {
    if (key === 'C') {
      onChange('')
      return
    }
    if (key === '⌫') {
      onChange(value.slice(0, -1))
      return
    }
    if (value === '0') {
      onChange(key)
      return
    }
    if (value.length >= 6) return
    onChange(value + key)
  }

  return (
    <div className={`grid grid-cols-3 gap-2 ${touch ? 'gap-2.5' : 'gap-1.5'}`}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className={`rounded-xl border border-gray-200 bg-white font-semibold tabular-nums text-gray-800 transition-colors ${
            touch
              ? 'min-h-14 text-xl active:bg-gray-100 active:scale-95'
              : 'py-3 text-lg hover:bg-gray-50'
          } ${key === 'C' ? 'text-amber-700' : ''}`}
        >
          {key === '⌫' ? <Delete size={touch ? 22 : 18} className="mx-auto" /> : key}
        </button>
      ))}
    </div>
  )
}
