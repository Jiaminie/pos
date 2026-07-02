import { upsertMany } from '@/lib/db/products'
import { normalizeBrand } from '@/lib/brands'
import { cleanProductName, skuFromName, uniqueSku } from '@/lib/normalize'
import type { Product } from '@/lib/types'

export type NewProductInput = {
  name: string
  sellingPrice: number
  /** Omit entirely when the user lacks cost-price permission — the server then
   *  skips its cost permission check and defaults the stored cost to 0. */
  costPrice?: number
  categoryId?: string
  /** Resolved category name for the server (which stores the name, not the id). */
  categoryName?: string | null
  brand?: string
  specification?: string
}

/**
 * Creates a product from a stock-count review row. The server POST is awaited
 * and must succeed BEFORE the product is stored locally / linked to the count —
 * inventory_transactions.product_id has a FK to products, so the product has to
 * exist server-side before its ADJUSTMENT can sync, or the whole sync batch fails.
 */
export async function createStockCountProduct(
  input: NewProductInput,
  existingSkus: Iterable<string>,
): Promise<Product> {
  const name = input.name.trim()
  const specification = input.specification?.trim() || undefined
  const baseSku = skuFromName(cleanProductName(name), specification) || 'item'
  const sku = uniqueSku(baseSku, existingSkus)
  const brand = normalizeBrand(input.brand ?? '') || 'UNBRANDED'

  const product: Product = {
    id: crypto.randomUUID(),
    name,
    sku,
    specification,
    sellingPrice: input.sellingPrice,
    costPrice: input.costPrice ?? 0,
    categoryId: input.categoryId ?? '',
    brand,
    createdAt: new Date().toISOString(),
  }

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      id: product.id,
      name: product.name,
      sku: product.sku,
      specification: product.specification ?? null,
      sellingPrice: product.sellingPrice,
      // Only sent when provided — omitting it keeps the server from requiring
      // cost-price permission for users who don't have it.
      ...(input.costPrice != null ? { costPrice: input.costPrice } : {}),
      category: input.categoryName ?? null,
      brand: product.brand,
    }),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json.error ?? 'Could not create product on the server')
  }

  // The server may have adjusted the sku to dodge a global-unique collision —
  // adopt its returned value so the local record stays consistent with the DB.
  const savedSku = typeof json.data?.sku === 'string' ? json.data.sku : product.sku
  const saved: Product = { ...product, sku: savedSku }
  await upsertMany([saved])
  return saved
}
