'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { commitCartQty } from '@/lib/cart-qty'
import { posActionBtnClass, posDialogContentClass, type DeviceUiMode } from '@/lib/device-ui'
import { QtyNumpad } from '@/components/pos/QtyNumpad'

type QtyEntryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  initialQty: number
  onConfirm: (qty: number) => void
  deviceUiMode: DeviceUiMode
  stockAvailable?: number | null
  stockUnit?: string
  confirmLabel?: string
  allowZero?: boolean
}

export function QtyEntryDialog({
  open,
  onOpenChange,
  title,
  subtitle,
  initialQty,
  onConfirm,
  deviceUiMode,
  stockAvailable,
  stockUnit,
  confirmLabel = 'OK',
  allowZero = false,
}: QtyEntryDialogProps) {
  const [draft, setDraft] = useState(String(initialQty))

  useEffect(() => {
    if (open) setDraft(String(initialQty))
  }, [open, initialQty])

  function handleConfirm() {
    const qty = commitCartQty(draft, initialQty)
    if (qty <= 0 && !allowZero) {
      toast.error('Enter a quantity of at least 1')
      return
    }
    if (stockAvailable != null && qty > stockAvailable) {
      toast.warning(`Only ${stockAvailable.toLocaleString()} ${stockUnit ?? 'in stock'}`, {
        description: 'Quantity saved — adjust if needed.',
      })
    }
    onConfirm(qty)
    onOpenChange(false)
  }

  const stockHint =
    stockAvailable != null
      ? `${stockAvailable.toLocaleString()} ${stockUnit ?? 'available'}`
      : null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" />
        <Dialog.Content className={`${posDialogContentClass(deviceUiMode)} z-[60]`}>
          <div className="flex items-start justify-between gap-3 mb-4 shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {subtitle && <p className="text-sm text-gray-500 mt-0.5 truncate">{subtitle}</p>}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="shrink-0 text-gray-500 hover:text-gray-600 p-1 rounded-md"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 mb-4">
            <p className="text-xs text-gray-500 mb-1">Quantity</p>
            <p className="text-3xl font-semibold tabular-nums text-gray-900 min-h-10">
              {draft || '0'}
            </p>
            {stockHint && <p className="text-xs text-gray-500 mt-1">In stock: {stockHint}</p>}
          </div>

          <QtyNumpad value={draft} onChange={setDraft} deviceUiMode={deviceUiMode} />

          <div className="grid grid-cols-2 gap-2 mt-5 shrink-0">
            <Dialog.Close asChild>
              <button
                type="button"
                className={`border border-gray-300 rounded-xl font-medium text-gray-700 hover:bg-gray-50 ${posActionBtnClass(deviceUiMode)} py-2.5`}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleConfirm}
              className={`bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 ${posActionBtnClass(deviceUiMode)} py-2.5`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
