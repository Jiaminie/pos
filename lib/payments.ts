export type PaymentMethod = 'CASH' | 'MPESA' | 'BANK'

export type SalePaymentInput = {
  id: string
  method: PaymentMethod
  bankName?: string | null
  amount: number
  reference?: string | null
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK', label: 'Bank' },
]

export const DEFAULT_BANK_OPTIONS = ['Cooperative Bank', 'Equity Bank']

/** Display name for a tender — the bank's own name stands in for "Bank". */
export function methodLabel(method: PaymentMethod, bankName?: string | null): string {
  if (method === 'BANK') return bankName?.trim() || 'Bank (unspecified)'
  return method === 'MPESA' ? 'M-Pesa' : 'Cash'
}

/** Stable grouping key for reconciliation reports. */
export function paymentKey(method: PaymentMethod, bankName?: string | null): string {
  return method === 'BANK' ? `BANK:${(bankName ?? '').trim().toLowerCase()}` : method
}

export function parseBankOptions(csv: string | null | undefined): string[] {
  const seen = new Set<string>()
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
}

export function serializeBankOptions(list: string[]): string {
  return parseBankOptions(list.join(',')).join(',')
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Single source of truth for "do these tenders match the sale?".
 *
 * Used by the POS sheet (to enable Confirm) and by the API (to store a
 * consistent set). It never throws and never returns an empty list: an
 * unattributed sale is worse than a mis-attributed one, and rejecting a sale
 * server-side would stall the whole offline backlog (see salesSyncQueue.drain).
 */
export function reconcilePayments(
  payments: SalePaymentInput[] | undefined,
  total: number,
): { payments: SalePaymentInput[]; adjusted: number } {
  const target = round2(total)
  const clean = (payments ?? [])
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
    .map((p) => ({
      id: p.id || crypto.randomUUID(),
      method: p.method,
      bankName: p.method === 'BANK' ? (p.bankName?.trim() || null) : null,
      amount: round2(p.amount),
      reference: p.reference?.trim() || null,
    }))

  if (clean.length === 0) {
    return {
      payments: [{ id: crypto.randomUUID(), method: 'CASH', bankName: null, amount: target, reference: null }],
      adjusted: target,
    }
  }

  const sum = round2(clean.reduce((s, p) => s + p.amount, 0))
  const delta = round2(target - sum)
  if (Math.abs(delta) < 0.01) return { payments: clean, adjusted: 0 }

  // Absorb the difference into the largest tender(s) — keeps sum(payments) == total.
  // Iterate because a single tender can't always absorb a large overpayment
  // (change due bigger than the largest tender); spread it until balanced.
  let residual = delta
  while (Math.abs(residual) >= 0.01) {
    let idx = 0
    for (let i = 1; i < clean.length; i++) if (clean[i].amount > clean[idx].amount) idx = i
    const cap = clean[idx].amount
    if (cap <= 0 && residual < 0) break
    const step = residual > 0 ? residual : Math.max(residual, -cap)
    clean[idx].amount = round2(Math.max(0, clean[idx].amount + step))
    residual = round2(residual - step)
  }

  return { payments: clean, adjusted: delta }
}

/** Outstanding balance for the POS sheet. Negative means change is due. */
export function remainingToPay(payments: SalePaymentInput[], total: number): number {
  const sum = payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0)
  return round2(total - sum)
}