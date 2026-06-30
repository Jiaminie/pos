import {
  clampUnitPrice,
  discountPerUnit,
  effectiveLowestPrice,
} from '@/lib/pricing'

type CartLine = {
  sellingPrice: number
  costPrice: number
  lowestPrice?: number | null
  unitPrice: number
  qty: number
}

export function maxCartDiscount(
  lines: CartLine[],
  minMarkupPercent: number = 150,
): number {
  return lines.reduce((sum, line) => {
    const floor = effectiveLowestPrice(line, minMarkupPercent)
    const perUnit = discountPerUnit(line.unitPrice, floor)
    return sum + perUnit * line.qty
  }, 0)
}

/** Allocate cart-level discount proportionally; clamp each line at floor. */
export function applyCartDiscount(
  lines: CartLine[],
  requestedAmount: number,
  minMarkupPercent: number = 150,
): { lines: CartLine[]; applied: number } {
  if (lines.length === 0 || requestedAmount <= 0) {
    return { lines, applied: 0 }
  }

  const maxAllowed = maxCartDiscount(lines, minMarkupPercent)
  const applied = Math.min(requestedAmount, maxAllowed)
  if (applied <= 0) return { lines, applied: 0 }

  const cartSubtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  if (cartSubtotal <= 0) return { lines, applied: 0 }

  const updated = lines.map((line) => {
    const share = applied * ((line.unitPrice * line.qty) / cartSubtotal)
    const perUnitShare = share / line.qty
    const newUnit = clampUnitPrice(
      line,
      line.unitPrice - perUnitShare,
      minMarkupPercent,
    )
    return { ...line, unitPrice: newUnit }
  })

  const actualApplied = lines.reduce((s, l, i) => {
    return s + (l.unitPrice - updated[i].unitPrice) * l.qty
  }, 0)

  return { lines: updated, applied: Math.round(actualApplied * 100) / 100 }
}
