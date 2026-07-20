import { upsertMany as upsertCategories, replaceAll as replaceCategories } from './categories'
import { upsertMany as upsertProducts, replaceAll as replaceProducts } from './products'
import { upsertMany as upsertUnits, replaceAll as replaceUnits } from './units'
import { upsertMany as upsertOrganizations, replaceAll as replaceOrganizations } from './organizations'
import { upsertMany as upsertBranches, replaceAll as replaceBranches } from './branches'
import { upsertMany as upsertTransfers } from './transfers'
import { upsertMany as upsertTransactions } from './transactions'
import { inferBrand, normalizeBrand } from '../brands'
import { getMyBranchId } from '../branch'
import type { Product, ProductCategory, Unit, Organization, Branch, StockTransfer, InventoryTransaction, TransactionType } from '../types'
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

const SYNC_TTL = 30 * 60 * 1000 // 30 minutes
// v3: opening stock is now scoped to the origin branch (see ownsOpeningStock
// below). Bumping the key forces existing devices to re-seed so non-origin
// branches drop the inherited initialStock baseline.
const SYNC_TS_KEY = 'pos_last_sync_v3'

// Incremental-sync watermark: the server clock at the last successful
// transaction pull. The inventory ledger is append-only (rows are never
// content-mutated — only `syncedAt` is stamped), so on a normal sync we only
// need transactions created at/after this mark instead of re-downloading the
// entire history every time. That full re-pull was the dominant network-transfer
// cost. A full pull (first seed, force, or replace) resets this to the server
// clock; deep-backdated admin inserts (rare, done via direct DB) are reconciled
// by the next force/replace, not incremental sync.
const TX_WATERMARK_KEY = 'pos_tx_sync_watermark_v1'

function getTxWatermark(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TX_WATERMARK_KEY)
}

function setTxWatermark(iso: string | null): void {
  if (typeof window === 'undefined' || !iso) return
  localStorage.setItem(TX_WATERMARK_KEY, iso)
}

type SyncOptions = {
  force?: boolean
  replace?: boolean
  onProgress?: (progress: CatalogSyncProgress) => void
}

type CatalogFetch = {
  categories: ProductCategory[]
  products: Product[]
  units: Unit[]
  organizations: Organization[]
  branches: Branch[]
  transfers: StockTransfer[]
  transactions: InventoryTransaction[]
  totalProducts?: number
  // Server clock at the start of the transaction pull, to persist as the next
  // incremental watermark. Null when the transaction fetch never ran.
  txWatermark: string | null
}

async function fetchCatalogFromServer(
  onProgress?: (progress: CatalogSyncProgress) => void,
  // When set, only transactions created at/after this instant are pulled
  // (incremental). Null/undefined pulls the entire ledger (first seed, force,
  // replace).
  sinceTx?: string | null,
): Promise<CatalogFetch | null> {
  const started = Date.now()
  let progress = initialSyncProgress()
  const report = (patch: Partial<CatalogSyncProgress>) => {
    progress = { ...progress, ...patch, elapsedMs: Date.now() - started }
    onProgress?.(progress)
  }

  report({ phase: 'categories', message: 'Fetching categories…' })

  const branchId = getMyBranchId()

  // Fetch reference data in parallel
  const [catRes, unitsRes, branchesRes, transfersRes] = await Promise.all([
    fetch('/api/products/categories', { cache: 'no-store' }),
    fetch('/api/units', { cache: 'no-store' }),
    fetch('/api/branches', { cache: 'no-store' }),
    branchId
      ? fetch(`/api/transfers?branchId=${branchId}&direction=incoming&status=PENDING`, { cache: 'no-store' })
      : Promise.resolve(null),
  ])

  if (!catRes.ok) return null
  const { data: catData } = await catRes.json()
  const units: Unit[] = unitsRes.ok ? ((await unitsRes.json()).data ?? []) : []

  // Branches + org from branches response
  const branchesData: Branch[] = branchesRes?.ok ? ((await branchesRes.json()).data ?? []) : []
  const organizations: Organization[] = branchesData.length > 0
    ? [{ id: branchesData[0].organizationId, name: '', country: 'KE' }]
    : []

  // Opening stock (product.quantity → initialStock) belongs only to the origin
  // branch — the HQ branch that historically accumulated the catalog everyone
  // else borrowed. Every other branch starts from 0 and builds its own stock
  // purely from its branch-scoped transactions (stock counts, restocks), so a
  // new branch is a clean slate. NB: HQ is identified by branch code, not the
  // isPrimary flag (in this org the primary branch is a different store). If the
  // device's branch can't be resolved yet (unsynced), keep opening stock to
  // avoid zeroing a legitimate single-branch store.
  const OPENING_STOCK_BRANCH_CODE = 'HQ'
  const myBranch = branchId ? branchesData.find((b) => b.id === branchId) : undefined
  const ownsOpeningStock = myBranch ? myBranch.code === OPENING_STOCK_BRANCH_CODE : true

  const transfers: StockTransfer[] = transfersRes?.ok
    ? ((await transfersRes.json()).data ?? []).map((t: Record<string, unknown>) => ({
        id:           t.id,
        fromBranchId: t.fromBranchId,
        toBranchId:   t.toBranchId,
        productId:    t.productId,
        quantity:     Number(t.quantity),
        status:       t.status,
        note:         t.note ?? undefined,
        fromDeviceId: t.fromDeviceId,
        toDeviceId:   t.toDeviceId ?? undefined,
        createdAt:    typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt as string).toISOString(),
        receivedAt:   t.receivedAt ? (typeof t.receivedAt === 'string' ? t.receivedAt : new Date(t.receivedAt as string).toISOString()) : undefined,
      }))
    : []

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
        barcode: p.barcode ?? undefined,
        specification: p.specification ?? undefined,
        stockUnit: p.stockUnit ?? undefined,
        sellingPrice: Number(p.sellingPrice),
        costPrice: Number(p.costPrice),
        lowestPrice: p.lowestPrice != null ? Number(p.lowestPrice) : undefined,
        categoryId: p.category ? slugify(p.category) : 'uncategorised',
        brand,
        imageUrl: p.imageUrl ?? undefined,
        initialStock: ownsOpeningStock ? parseInitialStock(p.quantity) : 0,
        createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      })
      recentNames.push(p.name)
    }

    cursor = meta?.hasMore ? (meta.nextCursor as string | null) : null

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

  if (totalProducts != null && totalProducts > 0 && products.length === 0) return null

  // Replicate the full movement log so every device computes identical stock.
  // Opening stock lives in product.quantity (initialStock); every other change
  // — sales, restocks, transfer receipts — lives here. Same stable cursor walk
  // as products. Server enum maps back to the client's: PURCHASE/RETURN are
  // stock-increasing (STOCK_IN); SALE/TRANSFER_OUT/ADJUSTMENT pass through.
  report({ phase: 'download', message: 'Downloading stock movements…', productsLoaded: products.length, totalProducts })
  const transactions: InventoryTransaction[] = []
  let txCursor: string | null = null
  let txWatermark: string | null = null
  const branchParam = branchId ? `&branchId=${branchId}` : ''
  const sinceParam = sinceTx ? `&since=${encodeURIComponent(sinceTx)}` : ''
  do {
    const url: string = `/api/transactions?slim=1&limit=200${branchParam}${sinceParam}${txCursor ? `&cursor=${txCursor}` : ''}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) break
    const { data, meta } = await res.json()
    // Server clock captured on the first page becomes the next watermark, so
    // rows inserted during this multi-page walk are caught next time.
    if (txWatermark == null && meta?.serverTime) txWatermark = meta.serverTime as string
    for (const t of data) {
      const type: TransactionType =
        t.type === 'PURCHASE' || t.type === 'RETURN' ? 'STOCK_IN' : t.type
      transactions.push({
        id: t.id,
        productId: t.productId,
        type,
        quantity: Number(t.quantity),
        unitPrice: t.unitPrice != null ? Number(t.unitPrice) : undefined,
        // Groups a sale's lines back into one receipt, and — on a STOCK_IN
        // remapped from a RETURN above — marks that sale as voided.
        saleId: t.saleId ?? undefined,
        source: t.source ?? undefined,
        sourceBranchId: t.sourceBranchId ?? undefined,
        branchId: t.branchId ?? undefined,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(t.createdAt).toISOString(),
      })
    }
    txCursor = meta?.hasMore ? (meta.nextCursor as string | null) : null
  } while (txCursor)

  return { categories, products, units, organizations, branches: branchesData, transfers, transactions, totalProducts, txWatermark }
}

export async function syncFromServer(options: SyncOptions = {}): Promise<boolean> {
  const { force = false, replace = false, onProgress } = options

  if (!force && typeof window !== 'undefined') {
    const last = parseInt(localStorage.getItem(SYNC_TS_KEY) ?? '0', 10)
    if (Date.now() - last < SYNC_TTL) return false
  }

  try {
    // Force/replace reconcile the whole ledger (sinceTx = null); a routine sync
    // pulls only what's new since the last watermark. First sync (no watermark)
    // naturally falls back to a full pull.
    const sinceTx = force || replace ? null : getTxWatermark()
    const catalog = await fetchCatalogFromServer(onProgress, sinceTx)
    if (!catalog) return false

    const { categories, products, units, organizations, branches, transfers, transactions } = catalog

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
      await replaceCategories(categories)
      await replaceProducts(products)
      if (units.length > 0)         await replaceUnits(units)
      if (organizations.length > 0) await replaceOrganizations(organizations)
      if (branches.length > 0)      await replaceBranches(branches)
    } else {
      if (categories.length > 0)    await upsertCategories(categories)
      if (products.length > 0)      await upsertProducts(products)
      if (units.length > 0)         await upsertUnits(units)
      if (organizations.length > 0) await upsertOrganizations(organizations)
      if (branches.length > 0)      await upsertBranches(branches)
    }
    if (transfers.length > 0) await upsertTransfers(transfers)
    // Merge by id — never clear. Preserves this device's not-yet-uploaded
    // movements while pulling in everyone else's. Drained ones re-arrive with
    // the same id and overwrite harmlessly (no double count).
    if (transactions.length > 0) await upsertTransactions(transactions)

    if (typeof window !== 'undefined') {
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()))
      // Advance the incremental watermark only after the merge succeeds, so a
      // failed pull re-fetches the same window next time rather than skipping it.
      setTxWatermark(catalog.txWatermark)
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

  // This replaces (clears + repopulates) the local catalog from the server, so
  // any product created locally but not yet pushed would be wiped. Flush the
  // pending product-create/update queue first so those items exist server-side
  // and come back in the fetch below instead of vanishing.
  try {
    const { drain: drainProductSync } = await import('./productSyncQueue')
    await drainProductSync()
  } catch {
    // Best effort — a failed/partial drain just means those items stay queued
    // and re-sync later; the merge path never deletes them.
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

    const { categories, products, units, organizations, branches, transfers, transactions, totalProducts, txWatermark } = catalog

    if (totalProducts != null && totalProducts > 0 && products.length === 0) {
      onProgress?.({
        phase: 'error',
        message: 'Download incomplete — local catalog was not changed',
        productsLoaded: 0,
        categoriesLoaded: 0,
        batchIndex: 0,
        recentNames: [],
        elapsedMs: elapsed(),
      })
      return { ok: false, productCount: 0 }
    }

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

    await replaceCategories(categories)
    await replaceProducts(products)
    if (units.length > 0)         await replaceUnits(units)
    if (organizations.length > 0) await replaceOrganizations(organizations)
    if (branches.length > 0)      await replaceBranches(branches)
    if (transfers.length > 0)     await upsertTransfers(transfers)
    // Merge the server movement log by id (don't wipe — keeps un-uploaded
    // local sales). Opening stock stays in product.quantity, so this never
    // double-counts it.
    if (transactions.length > 0)  await upsertTransactions(transactions)

    if (typeof window !== 'undefined') {
      localStorage.setItem(SYNC_TS_KEY, String(Date.now()))
      // Full reconcile just completed — set the incremental watermark so
      // subsequent routine syncs only fetch newer movements.
      setTxWatermark(txWatermark)
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

  const { getAll: getLocalProducts } = await import('./products')
  const existing = await getLocalProducts()
  if (existing.length > 0) return

  const synced = await syncFromServer({ force: true })
  if (synced) return

  const afterSync = await getLocalProducts()
  if (afterSync.length > 0) return

  const replaced = await replaceCatalogFromServer()
  if (replaced.ok) return

  await upsertCategories(FALLBACK_CATEGORIES)
}

export type { CatalogSyncProgress } from './sync-progress'
