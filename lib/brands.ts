import type { Product } from './types'

export { findProductByExactBarcode, matchesProductSearch, normalizeBarcode, barcodeSearchEnabled } from './product-search'

function cleanToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]/g, '')
}

/** Infer brand from SKU/name when legacy rows lack a stored brand. */
export function inferBrand(product: Pick<Product, 'name' | 'sku' | 'brand'>): string {
  const stored = product.brand?.trim()
  if (stored && stored !== 'UNBRANDED') return normalizeBrand(stored)

  const skuToken = cleanToken((product.sku ?? '').split(/[-_ ]+/)[0] ?? '')
  if (skuToken.length >= 2) return skuToken.toUpperCase()

  const nameToken = cleanToken((product.name ?? '').split(/\s+/)[0] ?? '')
  if (nameToken.length >= 2) return nameToken.toUpperCase()

  return 'UNBRANDED'
}

export function normalizeBrand(value: string): string {
  return value.trim().toUpperCase()
}

export function getProductBrand(product: Product): string {
  const stored = product.brand?.trim()
  if (stored) return normalizeBrand(stored)
  return inferBrand(product)
}

export function getBrandOptions(products: Product[]): string[] {
  const unique = new Set<string>()
  for (const product of products) unique.add(getProductBrand(product))
  return [...unique].sort((a, b) => a.localeCompare(b))
}
