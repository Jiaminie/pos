import { normalizeQuery } from './normalize'
import type { Product } from './types'

function cleanToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]/g, '')
}

export function inferBrand(product: Product): string {
  const skuToken = cleanToken((product.sku ?? '').split(/[-_ ]+/)[0] ?? '')
  if (skuToken.length >= 2) return skuToken.toUpperCase()

  const nameToken = cleanToken((product.name ?? '').split(/\s+/)[0] ?? '')
  if (nameToken.length >= 2) return nameToken.toUpperCase()

  return 'UNBRANDED'
}

export function getBrandOptions(products: Product[]): string[] {
  const unique = new Set<string>()
  for (const product of products) unique.add(inferBrand(product))
  return [...unique].sort((a, b) => a.localeCompare(b))
}

export function matchesProductSearch(
  product: Product,
  query: string,
  categoryName?: string | null,
): boolean {
  if (!query) return true
  const nq = normalizeQuery(query)
  if (!nq) return true

  return (
    normalizeQuery(product.name).includes(nq) ||
    normalizeQuery(product.sku).includes(nq) ||
    normalizeQuery(product.specification ?? '').includes(nq) ||
    normalizeQuery(inferBrand(product)).includes(nq) ||
    normalizeQuery(categoryName ?? '').includes(nq)
  )
}
