/** Minimum sell price as % of cost (150 = floor is 1.5× cost). */
export const DEFAULT_MIN_MARKUP_PERCENT = 150

type PriceFields = {
  costPrice: number
  sellingPrice: number
  lowestPrice?: number | null
}

/**
 * Effective discount floor for a product.
 * - Rule floor: cost × (minMarkupPercent / 100)
 * - Manual lowestPrice can only raise the floor, never lower it
 * - Never above selling price (no discount if floor ≥ sell)
 */
export function effectiveLowestPrice(
  product: PriceFields,
  minMarkupPercent: number = DEFAULT_MIN_MARKUP_PERCENT,
): number {
  const sell = product.sellingPrice
  if (sell <= 0) return 0

  const ruleFloor =
    product.costPrice > 0
      ? product.costPrice * (minMarkupPercent / 100)
      : sell

  const manual = product.lowestPrice
  const floor = manual != null ? Math.max(manual, ruleFloor) : ruleFloor

  return Math.min(sell, Math.max(0, floor))
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
