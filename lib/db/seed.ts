import { upsertMany as upsertCategories, replaceAll as replaceCategories, clearAll as clearCategories } from './categories'
import { upsertMany as upsertProducts, replaceAll as replaceProducts, clearAll as clearProducts } from './products'
import { clearAll as clearTransactions } from './transactions'
import { inferBrand, normalizeBrand } from '../brands'
import type { Product, ProductCategory } from '../types'
import type { CatalogSyncProgress } from './sync-progress'
import { initialSyncProgress } from './sync-progress'

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function parseInitialStock(qty: string | null | undefined): number {
  if (!qty) return 0
  const nums = qty.match(/\d+/g)
  return nums ? nums.reduce((s, n) => s + parseInt(n, 10), 0) : 0
}

const SYNC_TTL = 5 * 60 * 1000 // 5 minutes
const SYNC_TS_KEY = 'pos_last_sync_v2'

type SyncOptions = {
  force?: boolean
  replace?: boolean
  clearTransactions?: boolean
  onProgress?: (progress: CatalogSyncProgress) => void
}

type CatalogFetch = { categories: ProductCategory[]; products: Product[] }

async function fetchCatalogFromServer(
  onProgress?: (progress: CatalogSyncProgress) => void,
): Promise<CatalogFetch | null> {
  const started = Date.now()
  let progress = initialSyncProgress()
  const report = (patch: Partial<CatalogSyncProgress>) => {
    progress = { ...progress, ...patch, elapsedMs: Date.now() - started }
    onProgress?.(progress)
  }

  report({ phase: 'categories', message: 'Fetching categories…' })

  const catRes = await fetch('/api/products/categories', { cache: 'no-store' })
  if (!catRes.ok) return null
  const { data: catData } = await catRes.json()

  const categories: ProductCategory[] = ((catData?.categories ?? []) as string[])
    .filter(Boolean)
    .map((name) => ({ id: slugify(name), name }))

  report({
    categoriesLoaded: categories.length,
    message: categories.length > 0
      ? `Found ${categories.length} categories — downloading products…`
      : 'Downloading products…',
  })

  const products: Product[] = []
  let cursor: string | null = null
  let batchIndex = 0
  let totalProducts: number | undefined

  do {
    batchIndex++
    const url: string = `/api/products?limit=100${cursor ? `&cursor=${cursor}` : ''}`
    report({
      phase: 'download',
      batchIndex,
      message: totalProducts
        ? `Downloading products… ${products.length.toLocaleString()} of ${totalProducts.toLocaleString()}`
        : `Downloading batch ${batchIndex}…`,
      productsLoaded: products.length,
      totalProducts,
    })

    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const { data, meta } = await res.json()

    if (meta?.total != null) totalProducts = meta.total as number

    const recentNames: string[] = []
    for (const p of data) {
      const brand = normalizeBrand(
        p.brand?.trim() || inferBrand({ name: p.name, sku: p.sku, brand: '' }),
      )
      products.push({
        id: p.id,
        name: p.name,
        sku: p.sku,
        specification: p.specification ?? undefined,
        stockUnit: p.stockUnit ?? undefined,
        sellingPrice: Number(p.sellingPrice),
        costPrice: Number(p.costPrice),
        lowestPrice: p.lowestPrice != null ? Number(p.lowestPrice) : undefined,
        categoryId: p.category ? slugify(p.category) : 'uncategorised',
        brand,
        imageUrl: p.imageUrl ?? undefined,
        initialStock: parseInitialStock(p.quantity),
        createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      })
      recentNames.push(p.name)
    }

    cursor = meta?.hasMore ? meta.nextCursor : null

    report({
      phase: 'download',
      batchIndex,
      productsLoaded: products.length,
      totalProducts,
      recentNames: recentNames.slice(-4),
      message: totalProducts
        ? `Downloaded ${products.length.toLocaleString()} of ${totalProducts.toLocaleString()} products`
        : `Downloaded ${products.length.toLocaleString()} products so far…`,
    })
  } while (cursor)

  return { categories, products }
}

export async function syncFromServer(options: SyncOptions = {}): Promise<boolean> {
  const { force = false, replace = false, clearTransactions: wipeTx = false, onProgress } = options

  if (!force && typeof window !== 'undefined') {
    const last = parseInt(localStorage.getItem(SYNC_TS_KEY) ?? '0', 10)
    if (Date.now() - last < SYNC_TTL) return false
  }

  try {
    const catalog = await fetchCatalogFromServer(onProgress)
    if (!catalog) return false

    const { categories, products } = catalog

    if (replace) {
      onProgress?.({
        phase: 'write',
        message: `Saving ${products.length.toLocaleString()} products to this device…`,
        productsLoaded: products.length,
        totalProducts: products.length,
        categoriesLoaded: categories.length,
        batchIndex: 0,
        recentNames: [],
        elapsedMs: 0,
      })
      if (wipeTx) await clearTransactions()
      await clearProducts()
      await clearCategories()
      if (categories.length > 0) await replaceCategories(categories)
      if (products.length > 0) await replaceProducts(products)
    } else {
      if (categories.length > 0) await upsertCategories(categories)
      if (products.length > 0) await upsertProducts(products)
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()))
    }
    return true
  } catch {
    return false
  }
}

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

export async function forceSyncFromServer(): Promise<boolean> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SYNC_TS_KEY)
  }
  return syncFromServer({ force: true })
}

export async function replaceCatalogFromServer(
  onProgress?: (progress: CatalogSyncProgress) => void,
): Promise<{ ok: boolean; productCount: number }> {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(SYNC_TS_KEY)
  }

  const started = Date.now()
  const elapsed = () => Date.now() - started

  try {
    const catalog = await fetchCatalogFromServer(onProgress)
    if (!catalog) {
      onProgress?.({
        phase: 'error',
        message: 'Could not reach the server',
        productsLoaded: 0,
        categoriesLoaded: 0,
        batchIndex: 0,
        recentNames: [],
        elapsedMs: 0,
      })
      return { ok: false, productCount: 0 }
    }

    const { categories, products } = catalog

    onProgress?.({
      phase: 'write',
      message: `Saving ${products.length.toLocaleString()} products to this device…`,
      productsLoaded: products.length,
      totalProducts: products.length,
      categoriesLoaded: categories.length,
      batchIndex: 0,
      recentNames: [],
      elapsedMs: elapsed(),
    })

    await clearTransactions()
    await clearProducts()
    await clearCategories()
    if (categories.length > 0) await replaceCategories(categories)
    if (products.length > 0) await replaceProducts(products)

    if (typeof window !== 'undefined') {
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()))
    }

    onProgress?.({
      phase: 'done',
      message: `Catalog ready — ${products.length.toLocaleString()} products`,
      productsLoaded: products.length,
      totalProducts: products.length,
      categoriesLoaded: categories.length,
      batchIndex: 0,
      recentNames: [],
      elapsedMs: elapsed(),
    })

    return { ok: true, productCount: products.length }
  } catch {
    onProgress?.({
      phase: 'error',
      message: 'Sync failed — try again',
      productsLoaded: 0,
      categoriesLoaded: 0,
      batchIndex: 0,
      recentNames: [],
      elapsedMs: 0,
    })
    return { ok: false, productCount: 0 }
  }
}

export async function seedIfEmpty(): Promise<void> {
  if (typeof window === 'undefined') return

  const synced = await syncFromServer()
  if (synced) return

  const { getAll } = await import('./products')
  const existing = await getAll()
  if (existing.length > 0) return

  await upsertCategories(FALLBACK_CATEGORIES)
}

export type { CatalogSyncProgress } from './sync-progress'
