import { getProductBrand } from './brands'
import { normalizeQuery } from './normalize'
import type { PosLookupMode } from './settings'
import type { Product } from './types'

export function normalizeBarcode(value: string): string {
  return value.trim().replace(/\s/g, '')
}

export function barcodeSearchEnabled(mode: PosLookupMode): boolean {
  return mode === 'barcode' || mode === 'hybrid'
}

export function findProductByExactBarcode(products: Product[], query: string): Product | null {
  const nq = normalizeBarcode(query)
  if (!nq) return null
  const matches = products.filter((p) => p.barcode && normalizeBarcode(p.barcode) === nq)
  return matches.length === 1 ? matches[0] : null
}

export function matchesProductSearch(
  product: Product,
  query: string,
  categoryName?: string | null,
  options?: { includeBarcode?: boolean },
): boolean {
  if (!query) return true
  const nq = normalizeQuery(query)
  if (!nq) return true

  const includeBarcode = options?.includeBarcode ?? false

  return (
    normalizeQuery(product.name).includes(nq) ||
    normalizeQuery(product.sku).includes(nq) ||
    normalizeQuery(product.specification ?? '').includes(nq) ||
    normalizeQuery(getProductBrand(product)).includes(nq) ||
    normalizeQuery(categoryName ?? '').includes(nq) ||
    (includeBarcode && product.barcode
      ? normalizeQuery(product.barcode).includes(nq)
      : false)
  )
}
