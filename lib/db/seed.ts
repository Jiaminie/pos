import { upsertMany as upsertCategories } from './categories'
import { upsertMany as upsertProducts } from './products'
import type { Product, ProductCategory } from '../types'

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseInitialStock(qty: string | null | undefined): number {
  if (!qty) return 0
  // Sum all integers in the string: "300 pcs + 140" → 440, "10 pcs" → 10
  const nums = qty.match(/\d+/g)
  return nums ? nums.reduce((s, n) => s + parseInt(n, 10), 0) : 0
}

const SYNC_TTL = 5 * 60 * 1000 // 5 minutes
const SYNC_TS_KEY = 'pos_last_sync_v2' // bumped to force re-sync with initialStock

export async function syncFromServer(): Promise<boolean> {
  if (typeof window !== 'undefined') {
    const last = parseInt(localStorage.getItem(SYNC_TS_KEY) ?? '0', 10)
    if (Date.now() - last < SYNC_TTL) return false
  }
  try {
    const catRes = await fetch('/api/products/categories')
    if (!catRes.ok) return false
    const { data: catData } = await catRes.json()

    const categories: ProductCategory[] = ((catData?.categories ?? []) as string[])
      .filter(Boolean)
      .map((name) => ({ id: slugify(name), name }))

    const products: Product[] = []
    let cursor: string | null = null

    do {
      const url: string = `/api/products?limit=100${cursor ? `&cursor=${cursor}` : ''}`
      const res = await fetch(url)
      if (!res.ok) return false
      const { data, meta } = await res.json()

      for (const p of data) {
        products.push({
          id: p.id,
          name: p.specification ? `${p.name} ${p.specification}` : p.name,
          sku: p.sku,
          sellingPrice: Number(p.sellingPrice),
          costPrice: Number(p.costPrice),
          categoryId: p.category ? slugify(p.category) : 'uncategorised',
          imageUrl: p.imageUrl ?? undefined,
          initialStock: parseInitialStock(p.quantity),
        })
      }

      cursor = meta?.hasMore ? meta.nextCursor : null
    } while (cursor)

    if (categories.length > 0) await upsertCategories(categories)
    if (products.length > 0) await upsertProducts(products)

    if (typeof window !== 'undefined') {
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()))
    }
    return true
  } catch {
    return false
  }
}

// Fallback hardcoded data used only when the server is unreachable
const FALLBACK_CATEGORIES: ProductCategory[] = [
  { id: 'adhesives-sealants', name: 'Adhesives & Sealants' },
  { id: 'taps-faucets',       name: 'Taps & Faucets' },
  { id: 'pipes-fittings',     name: 'Pipes & Fittings' },
  { id: 'valves',             name: 'Valves' },
  { id: 'bathroom-accessories', name: 'Bathroom Accessories' },
  { id: 'locks-security',     name: 'Locks & Security' },
  { id: 'tools-equipment',    name: 'Tools & Equipment' },
  { id: 'abrasives-cutting-discs', name: 'Abrasives & Cutting Discs' },
  { id: 'clips-fasteners',    name: 'Clips & Fasteners' },
]

export async function seedIfEmpty(): Promise<void> {
  if (typeof window === 'undefined') return

  const synced = await syncFromServer()
  if (synced) return

  // Offline fallback: only seed if IndexedDB is empty
  const { getAll } = await import('./products')
  const existing = await getAll()
  if (existing.length > 0) return

  await upsertCategories(FALLBACK_CATEGORIES)
  // No hardcoded products — shop staff will add them when back online
}
