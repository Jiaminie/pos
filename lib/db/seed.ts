import { upsertMany as upsertCategories } from './categories'
import { upsertMany as upsertProducts } from './products'
import type { Product, ProductCategory } from '../types'

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function syncFromServer(): Promise<boolean> {
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
        })
      }

      cursor = meta?.hasMore ? meta.nextCursor : null
    } while (cursor)

    if (categories.length > 0) await upsertCategories(categories)
    if (products.length > 0) await upsertProducts(products)

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
