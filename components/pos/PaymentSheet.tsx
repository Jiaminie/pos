'use client'

import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Plus, X } from 'lucide-react'
import { PAYMENT_METHODS, remainingToPay, type PaymentMethod, type SalePaymentInput } from '@/lib/payments'
import { posDialogBodyClass, posDialogContentClass, type DeviceUiMode } from '@/lib/device-ui'

type TenderDraft = {
  id: string
  method: PaymentMethod
  bankName: string
  reference: string
  amount: string
}

export default function PaymentSheet({
  open,
  total,
  bankOptions,
  busy,
  deviceUiMode,
  onCancel,
  onConfirm,
}: {
  open: boolean
  total: number
  bankOptions: string[]
  busy: boolean
  deviceUiMode: DeviceUiMode
  onCancel: () => void
  onConfirm: (payments: SalePaymentInput[]) => void
}) {
  const [tenders, setTenders] = useState<TenderDraft[]>(() => [initialTender(total)])
  const [addingBank, setAddingBank] = useState(false)
  const [newBankName, setNewBankName] = useState('')

  const parsed = useMemo(
    () =>
      tenders.map((t) => ({ ...t, amount: parseFloat(t.amount) })).map((t) => ({
        ...t,
        amount: Number.isFinite(t.amount) ? t.amount : 0,
      })),
    [tenders],
  )

  const numeric = parsed.map((t) => ({ method: t.method, bankName: t.bankName, amount: t.amount, id: t.id }))
  const remaining = remainingToPay(numeric, total)

  const bankDraftMissing = parsed.some((t) => t.method === 'BANK' && t.bankName.trim() === '')
  const confirmDisabled = busy || remaining > 0.01 || bankDraftMissing

  function updateTender(id: string, patch: Partial<TenderDraft>) {
    setTenders((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function removeTender(id: string) {
    setTenders((prev) => prev.filter((t) => t.id !== id))
  }

  function addTender() {
    const bal = remainingToPay(numeric, total)
    if (bal <= 0) return
    setTenders((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        method: 'MPESA',
        bankName: '',
        reference: '',
        amount: bal > 0 ? String(round2(bal)) : '0',
      },
    ])
  }

  function confirm() {
    if (confirmDisabled) return
    const payments: SalePaymentInput[] = parsed
      .map(({ reference, bankName, ...rest }) => ({
        ...rest,
        amount: round2(rest.amount),
        bankName: rest.method === 'BANK' ? bankName.trim() || null : null,
        reference: reference.trim() || null,
      }))
      .filter((p) => p.amount > 0)
    onConfirm(payments)
  }

  const covered = remaining <= 0.01
  const changeDue = remaining < 0

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content className={posDialogContentClass(deviceUiMode, 'max-w-lg')}>
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div>
              <Dialog.Title className="text-lg font-semibold">Payment</Dialog.Title>
              <p className="text-xs text-gray-500">Total KES {total.toLocaleString()}</p>
            </div>
            <Dialog.Close asChild>
              <button className="text-gray-500 hover:text-gray-600 p-1 rounded-md"><X size={18} /></button>
            </Dialog.Close>
          </div>

          <div className={`${posDialogBodyClass()} space-y-4`}>
            {tenders.map((t) => (
              <div key={t.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => updateTender(t.id, { method: m.value, bankName: m.value === 'BANK' ? t.bankName : '' })}
                        className={`px-3 min-h-11 rounded-lg text-sm font-medium transition-colors ${
                          t.method === m.value
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {tenders.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove tender"
                      onClick={() => removeTender(t.id)}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {t.method === 'BANK' && (
                  <select
                    value={addingBank ? '__add__' : t.bankName}
                    onChange={(e) => {
                      const v = e.target.value
                      if (v === '__add__') {
                        setAddingBank(true)
                        updateTender(t.id, { bankName: '' })
                      } else {
                        setAddingBank(false)
                        updateTender(t.id, { bankName: v })
                      }
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select bank…</option>
                    {bankOptions.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                    <option value="__add__">+ Add bank</option>
                  </select>
                )}
                {t.method === 'BANK' && addingBank && (
                  <input
                    type="text"
                    value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)}
                    onBlur={() => {
                      if (newBankName.trim()) {
                        updateTender(t.id, { bankName: newBankName.trim() })
                        setNewBankName('')
                      }
                      setAddingBank(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        updateTender(t.id, { bankName: newBankName.trim() || t.bankName })
                        setNewBankName('')
                        setAddingBank(false)
                      }
                    }}
                    placeholder="Type new bank name…"
                    className="w-full min-h-11 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-700">Amount</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={t.amount}
                      onChange={(e) => updateTender(t.id, { amount: e.target.value })}
                      className="w-full min-h-11 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-700">Reference (optional)</label>
                    <input
                      type="text"
                      value={t.reference}
                      onChange={(e) => updateTender(t.id, { reference: e.target.value })}
                      placeholder="M-Pesa code / slip no."
                      className="w-full min-h-11 border border-gray-300 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={addTender}
              disabled={remaining <= 0}
              className="w-full flex items-center justify-center gap-1.5 min-h-11 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <Plus size={15} />
              Add another method
            </button>
          </div>

          <div className="shrink-0 border-t pt-3 mt-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Total</span>
              <span className="font-semibold">KES {total.toLocaleString()}</span>
            </div>
            <p
              className={`text-sm font-medium ${
                covered ? 'text-green-600' : changeDue ? 'text-blue-600' : 'text-amber-600'
              }`}
            >
              {covered
                ? 'Covered'
                : changeDue
                  ? `Change KSh ${Math.abs(remaining).toLocaleString()}`
                  : `Remaining KSh ${remaining.toLocaleString()}`}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Dialog.Close asChild>
                <button className="min-h-11 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                onClick={confirm}
                disabled={confirmDisabled}
                className="min-h-11 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                {busy ? 'Processing…' : 'Confirm'}
                {!busy && <Check size={14} />}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const round2 = (n: number) => Math.round(n * 100) / 100

function initialTender(total: number): TenderDraft {
  return { id: crypto.randomUUID(), method: 'CASH', bankName: '', reference: '', amount: String(total) }
}