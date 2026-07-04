/** Minimum sell price as % of buying price (150 = floor is 1.5× buying price). */
export const DEFAULT_MIN_MARKUP_PERCENT = 150

type PriceFields = {
  costPrice: number
  sellingPrice: number
  lowestPrice?: number | null
}

/**
 * Effective discount floor for a product.
 * - A manually-set lowestPrice IS the floor — it's the seller's own minimum and
 *   wins outright, even below the buying price. This gives full control over how
 *   low they're willing to go; discounts are computed from sell down to it.
 * - When no manual floor is set, fall back to the markup rule:
 *   buying price × (minMarkupPercent / 100).
 * - Never above selling price (no discount if floor ≥ sell).
 */
export function effectiveLowestPrice(
  product: PriceFields,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): number {
  const sell = product.sellingPrice
  if (sell <= 0) return 0

  const manual = product.lowestPrice
  if (manual != null) return Math.min(sell, Math.max(0, manual))

  const ruleFloor =
    product.costPrice > 0
      ? product.costPrice * (minMarkupPercent / 100)
      : sell

  return Math.min(sell, Math.max(0, ruleFloor))
}

export function canDiscount(
  product: PriceFields,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): boolean {
  return effectiveLowestPrice(product, minMarkupPercent) < product.sellingPrice
}

export function discountPerUnit(sellingPrice: number, unitPrice: number): number {
  return Math.max(0, sellingPrice - unitPrice)
}

/** Max discount allowed per unit (sell − effective floor). */
export function maxDiscountPerUnit(
  product: PriceFields,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): number {
  if (product.sellingPrice <= 0) return 0
  return discountPerUnit(product.sellingPrice, effectiveLowestPrice(product, minMarkupPercent))
}

export function clampUnitPrice(
  product: PriceFields,
  unitPrice: number,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): number {
  const min = effectiveLowestPrice(product, minMarkupPercent)
  const max = product.sellingPrice
  return Math.min(max, Math.max(min, unitPrice))
}

/** POS cart line — enforce floor only; allow markup above list for this sale. */
export function clampCartUnitPrice(
  product: PriceFields,
  price: number,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): number {
  const min = effectiveLowestPrice(product, minMarkupPercent)
  return Math.max(min, price)
}

/** @deprecated Use clampCartUnitPrice — cart prices must not mutate catalog list price. */
export const clampSavedSellingPrice = clampCartUnitPrice
