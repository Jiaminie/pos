'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { QTY_STEP_PRESETS, commitCartQty } from '@/lib/cart-qty'
import { isTouchOptimized, posQtyBtnClass, type DeviceUiMode } from '@/lib/device-ui'

type CartQtyControlProps = {
  qty: number
  deviceUiMode: DeviceUiMode
  stockAvailable?: number | null
  stockUnit?: string
  onDelta: (delta: number) => void
  onSetQty: (qty: number) => void
}

export function CartQtyControl({
  qty,
  deviceUiMode,
  stockAvailable,
  stockUnit,
  onDelta,
  onSetQty,
}: CartQtyControlProps) {
  const touchMode = isTouchOptimized(deviceUiMode)
  const [draft, setDraft] = useState(String(qty))
  const inputRef = useRef<HTMLInputElement>(null)
  const editingRef = useRef(false)

  useEffect(() => {
    if (!editingRef.current) setDraft(String(qty))
  }, [qty])

  function commitDraft(raw = draft) {
    editingRef.current = false
    const next = commitCartQty(raw, qty)
    if (next <= 0) {
      onSetQty(0)
      return
    }
    if (stockAvailable != null && next > stockAvailable) {
      toast.warning(`Only ${stockAvailable.toLocaleString()} ${stockUnit ?? 'in stock'}`, {
        description: 'Quantity updated — adjust if needed.',
      })
    }
    setDraft(String(next))
    if (next !== qty) onSetQty(next)
  }

  function handleFocus() {
    editingRef.current = true
    inputRef.current?.select()
  }

  function handleBlur() {
    commitDraft()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      editingRef.current = false
      setDraft(String(qty))
      inputRef.current?.blur()
    }
  }

  return (
    <div className="w-full min-w-0 space-y-2">
      <div className={`flex items-center ${touchMode ? 'gap-2' : 'gap-1'}`}>
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mr-0.5">
          Qty
        </span>
        <button
          type="button"
          onClick={() => onDelta(-1)}
          className={posQtyBtnClass(deviceUiMode)}
          aria-label="Decrease quantity"
        >
          <Minus size={touchMode ? 18 : 12} />
        </button>

        <input
          ref={inputRef}
          type="number"
          min={1}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className={`text-center tabular-nums font-medium border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 ${
            touchMode
              ? 'min-h-10 w-[3.25rem] text-base px-1.5 py-1 rounded-lg'
              : 'w-14 text-sm px-1 py-1 rounded-md'
          }`}
          aria-label="Quantity"
        />

        <button
          type="button"
          onClick={() => onDelta(1)}
          className={posQtyBtnClass(deviceUiMode)}
          aria-label="Increase quantity"
        >
          <Plus size={touchMode ? 18 : 12} />
        </button>
      </div>

      <div className={`grid grid-cols-3 gap-1 ${touchMode ? 'gap-1.5' : ''}`}>
        {QTY_STEP_PRESETS.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => onDelta(step)}
            className={`rounded-md border border-gray-200 bg-white text-gray-600 tabular-nums transition-colors ${
              touchMode
                ? 'min-h-8 text-xs font-medium active:bg-gray-100 active:border-blue-300 active:text-blue-700'
                : 'py-1 text-[10px] hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700'
            }`}
          >
            +{step}
          </button>
        ))}
      </div>
    </div>
  )
}
