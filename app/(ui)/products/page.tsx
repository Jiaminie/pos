'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import * as Label from '@radix-ui/react-label'
import * as Select from '@radix-ui/react-select'
import { AlertTriangle, Camera, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Upload, X } from 'lucide-react'
import { CategoryPicker } from '@/components/pos/CategoryPicker'
import { BulkUploadWizard } from '@/components/products/BulkUploadWizard'
import { CatalogSyncOverlay } from '@/components/products/CatalogSyncOverlay'
import { ProductImageField } from '@/components/products/ProductImageField'
import { toast } from 'sonner'
import { getAll as getProducts, upsertMany } from '@/lib/db/products'
import { getAll as getCategories, upsertMany as upsertCategories } from '@/lib/db/categories'
import { create as createTx, getAll as getTransactions } from '@/lib/db/transactions'
import { push as pushTx, drain } from '@/lib/db/syncQueue'
import { replaceCatalogFromServer, seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import type { CatalogSyncProgress } from '@/lib/db/sync-progress'
import { initialSyncProgress } from '@/lib/db/sync-progress'
import { ADDED_RANGES, isInAddedRange, type AddedRange } from '@/lib/dates'
import { cleanProductName, normalizeQuery, skuFromName, uniqueSku } from '@/lib/normalize'
import { effectiveLowestPrice, maxDiscountPerUnit, DEFAULT_MIN_MARKUP_PERCENT } from '@/lib/pricing'
import { fetchSettings } from '@/lib/settings'
import { computeStock, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import type { Product, ProductCategory, InventoryTransaction } from '@/lib/types'

const emptyForm = {
  name: '', sku: '', specification: '', stockUnit: 'pcs',
  sellingPrice: '', costPrice: '', lowestPrice: '',
  openingStock: '', addStock: '', categoryId: '', newCategory: '', imageUrl: '',
}
const PAGE_SIZE = 20

function ProductsPageContent() {
  const searchParams = useSearchParams()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [open, setOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dupWarning, setDupWarning] = useState<string[]>([])
  const skuTouched = useRef(false)
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all')
  const [filterMissingPrices, setFilterMissingPrices] = useState(false)
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all')
  const [addedFilter, setAddedFilter] = useState<AddedRange>('all')
  const [restockQtys, setRestockQtys] = useState<Record<string, string>>({})
  const [restocking, setRestocking] = useState<Record<string, boolean>>({})
  const [bulkOpen, setBulkOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncProgress, setSyncProgress] = useState<CatalogSyncProgress | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [minMarkupPercent, setMinMarkupPercent] = useState(DEFAULT_MIN_MARKUP_PERCENT)

  async function refreshCatalogFromServer() {
    setRefreshing(true)
    setSyncProgress(initialSyncProgress())
    try {
      const sync = await replaceCatalogFromServer(setSyncProgress)
      if (!sync.ok) {
        toast.error('Could not sync from server — check your connection')
        return
      }
      await loadCatalog()
      await new Promise((r) => setTimeout(r, 600))
      toast.success(`Catalog refreshed — ${sync.productCount.toLocaleString()} products`)
    } finally {
      setRefreshing(false)
      setSyncProgress(null)
    }
  }

  async function loadCatalog() {
    const [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
    if (prods.length > 0) {
      setCategories(cats); setProducts(prods); setTransactions(txs)
    } else {
      await seedIfEmpty()
      const [c, p, t] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      setCategories(c); setProducts(p); setTransactions(t)
    }
    const synced = await syncFromServer()
    if (synced) {
      const [c, p, t] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      setCategories(c); setProducts(p); setTransactions(t)
    }
  }

  function setFilter(id: string) {
    setFilterCategoryId(id)
    setPage(1)
  }

  function handleSearch(q: string) {
    setSearch(q)
    setPage(1)
  }

  useEffect(() => {
    loadCatalog()
    fetchSettings().then((s) => setMinMarkupPercent(s.minMarkupPercent)).catch(() => {})
  }, [])

  useEffect(() => {
    const stock = searchParams.get('stock')
    if (stock === 'low' || stock === 'out') {
      setStockFilter(stock)
      setPage(1)
    }
  }, [searchParams])

  async function handleRestock(product: Product) {
    const q = parseInt(restockQtys[product.id] ?? '', 10)
    if (!q || q < 1) {
      toast.error('Enter a valid quantity')
      return
    }
    setRestocking((r) => ({ ...r, [product.id]: true }))
    try {
      const tx: InventoryTransaction = {
        id: crypto.randomUUID(),
        type: 'STOCK_IN',
        productId: product.id,
        quantity: q,
        createdAt: new Date().toISOString(),
      }
      await createTx(tx)
      await pushTx(tx)
      drain().catch(() => {})
      setTransactions((prev) => [tx, ...prev])
      setRestockQtys((r) => ({ ...r, [product.id]: '' }))
      toast.success(`Restocked — ${product.name}`, {
        description: `+${q} ${product.stockUnit ?? 'units'} added`,
      })
    } finally {
      setRestocking((r) => ({ ...r, [product.id]: false }))
    }
  }

  function setStockFilterAndReset(f: 'all' | 'low' | 'out') {
    setStockFilter(f)
    setFilterMissingPrices(false)
    setPage(1)
  }

  function setAddedFilterAndReset(f: AddedRange) {
    setAddedFilter(f)
    setPage(1)
  }

  async function uploadProductImage(file: File) {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.data?.url) {
        setForm((f) => ({ ...f, imageUrl: json.data.url }))
        toast.success('Photo attached')
      } else {
        toast.error(json.error ?? 'Upload failed')
      }
    } catch {
      toast.error('Upload failed — check your connection')
    } finally {
      setUploading(false)
    }
  }

  function field(key: keyof typeof emptyForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  function checkDuplicates(name: string) {
    if (!name.trim() || editingProduct) { setDupWarning([]); return }
    const nq = normalizeQuery(name)
    const matches = products
      .filter((p) => normalizeQuery(p.name).includes(nq) || nq.includes(normalizeQuery(p.name)))
      .map((p) => p.name)
    setDupWarning(matches.slice(0, 3))
  }

  function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    const name = e.target.value
    setForm((f) => ({
      ...f,
      name,
      ...(shouldAutoSku() && { sku: skuFromName(name, f.specification) }),
    }))
    checkDuplicates(name)
  }

  function handleNameBlur(e: React.FocusEvent<HTMLInputElement>) {
    const cleaned = cleanProductName(e.target.value)
    setForm((f) => ({
      ...f,
      name: cleaned,
      ...(shouldAutoSku() && { sku: skuFromName(cleaned, f.specification) }),
    }))
    checkDuplicates(cleaned)
  }

  function handleSpecChange(e: React.ChangeEvent<HTMLInputElement>) {
    const specification = e.target.value
    setForm((f) => ({
      ...f,
      specification,
      ...(shouldAutoSku() && { sku: skuFromName(f.name, specification) }),
    }))
  }

  function shouldAutoSku() {
    return !editingProduct || !skuTouched.current
  }

  function handleSkuChange(e: React.ChangeEvent<HTMLInputElement>) {
    skuTouched.current = true
    setForm((f) => ({ ...f, sku: e.target.value }))
  }

  function openAdd() {
    skuTouched.current = false
    setEditingProduct(null)
    setForm(emptyForm)
    setDupWarning([])
    setOpen(true)
  }

  function openEdit(p: Product) {
    skuTouched.current = true
    setEditingProduct(p)
    setDupWarning([])
    setForm({
      name: p.name,
      sku: p.sku,
      specification: p.specification ?? '',
      stockUnit: p.stockUnit ?? 'pcs',
      sellingPrice: String(p.sellingPrice),
      costPrice: String(p.costPrice),
      lowestPrice: p.lowestPrice != null ? String(p.lowestPrice) : '',
      openingStock: '',
      addStock: '',
      categoryId: p.categoryId ?? '',
      newCategory: '',
      imageUrl: p.imageUrl ?? '',
    })
    setOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    try {
      let categoryId = form.categoryId
      if (!categoryId && form.newCategory.trim()) {
        const newCat: ProductCategory = { id: crypto.randomUUID(), name: form.newCategory.trim() }
        await upsertCategories([newCat])
        setCategories((prev) => [...prev, newCat])
        categoryId = newCat.id
      }

      const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null
      const sellingPrice = parseFloat(form.sellingPrice) || 0
      const costPrice = parseFloat(form.costPrice) || 0
      const lowestPrice = form.lowestPrice.trim() ? parseFloat(form.lowestPrice) : undefined

      if (lowestPrice !== undefined && lowestPrice > sellingPrice) {
        toast.error('Lowest price cannot exceed selling price')
        return
      }

      if (editingProduct) {
        const updated: Product = {
          ...editingProduct,
          name: form.name,
          sku: form.sku,
          specification: form.specification || undefined,
          stockUnit: form.stockUnit || undefined,
          sellingPrice,
          costPrice,
          lowestPrice,
          categoryId,
          ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
        }
        await upsertMany([updated])
        await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: updated.name,
            sku: updated.sku,
            specification: updated.specification ?? null,
            stockUnit: updated.stockUnit ?? null,
            sellingPrice: updated.sellingPrice,
            costPrice: updated.costPrice,
            lowestPrice: updated.lowestPrice ?? null,
            category: categoryName,
            imageUrl: updated.imageUrl ?? null,
          }),
        })
        setProducts((prev) => prev.map((p) => p.id === updated.id ? updated : p))

        // Restock if requested
        const addQty = parseInt(form.addStock, 10)
        if (addQty > 0) {
          const tx: InventoryTransaction = {
            id: crypto.randomUUID(),
            type: 'STOCK_IN',
            productId: updated.id,
            quantity: addQty,
            createdAt: new Date().toISOString(),
          }
          await createTx(tx)
          await pushTx(tx)
          drain().catch(() => {})
          setTransactions((prev) => [tx, ...prev])
          toast.success(`Product updated — +${addQty} ${updated.stockUnit ?? 'units'} added to stock`)
        } else {
          toast.success('Product updated')
        }
      } else {
        const baseSku = skuFromName(cleanProductName(form.name), form.specification || undefined) || 'item'
        const sku = uniqueSku(baseSku, products.map((p) => p.sku))

        const product: Product = {
          id: crypto.randomUUID(),
          name: form.name,
          sku,
          specification: form.specification || undefined,
          stockUnit: form.stockUnit || undefined,
          sellingPrice,
          costPrice,
          lowestPrice,
          categoryId,
          createdAt: new Date().toISOString(),
          ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
        }
        await upsertMany([product])

        // Record opening stock as a STOCK_IN transaction
        const openingQty = parseInt(form.openingStock, 10)
        if (openingQty > 0) {
          const tx: InventoryTransaction = {
            id: crypto.randomUUID(),
            type: 'STOCK_IN',
            productId: product.id,
            quantity: openingQty,
            createdAt: new Date().toISOString(),
          }
          await createTx(tx)
          await pushTx(tx)
          drain().catch(() => {})
          setTransactions((prev) => [tx, ...prev])
        }

        await fetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: product.id,
            name: product.name,
            sku: product.sku,
            specification: product.specification ?? null,
            stockUnit: product.stockUnit ?? null,
            sellingPrice: product.sellingPrice,
            costPrice: product.costPrice,
            lowestPrice: product.lowestPrice ?? null,
            category: categoryName,
            imageUrl: product.imageUrl ?? null,
          }),
        })
        setProducts((prev) => [product, ...prev])
        setPage(1)
        toast.success('Product saved')
      }

      setForm(emptyForm)
      setEditingProduct(null)
      setDupWarning([])
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
    return counts
  }, [products])

  const nq = normalizeQuery(search.trim())
  const missingPriceCount = products.filter((p) => p.costPrice <= 0 || p.sellingPrice <= 0).length
  const lowStockCount = useMemo(
    () => products.filter((p) => {
      const s = computeStock(p.id, transactions, p.initialStock ?? 0)
      return s > 0 && s < LOW_STOCK_THRESHOLD
    }).length,
    [products, transactions],
  )

  const visible = useMemo(() => {
    const rows = products
      .filter((p) => filterCategoryId === 'all' || p.categoryId === filterCategoryId)
      .filter((p) => !filterMissingPrices || p.costPrice <= 0 || p.sellingPrice <= 0)
      .filter((p) => isInAddedRange(p.createdAt, addedFilter))
      .filter(
        (p) =>
          !nq ||
          normalizeQuery(p.name).includes(nq) ||
          normalizeQuery(p.sku).includes(nq) ||
          normalizeQuery(p.specification ?? '').includes(nq),
      )
      .map((p) => ({
        product: p,
        stock: computeStock(p.id, transactions, p.initialStock ?? 0),
      }))
      .filter(({ stock }) => {
        if (stockFilter === 'low') return stock > 0 && stock < LOW_STOCK_THRESHOLD
        if (stockFilter === 'out') return stock <= 0
        return true
      })

    if (addedFilter !== 'all') {
      rows.sort((a, b) => {
        const ta = a.product.createdAt ? new Date(a.product.createdAt).getTime() : 0
        const tb = b.product.createdAt ? new Date(b.product.createdAt).getTime() : 0
        return tb - ta
      })
    } else if (stockFilter !== 'all' || filterMissingPrices) {
      rows.sort((a, b) => {
        if (a.stock < LOW_STOCK_THRESHOLD && b.stock >= LOW_STOCK_THRESHOLD) return -1
        if (b.stock < LOW_STOCK_THRESHOLD && a.stock >= LOW_STOCK_THRESHOLD) return 1
        return a.product.name.localeCompare(b.product.name)
      })
    }

    return rows
  }, [products, filterCategoryId, filterMissingPrices, addedFilter, nq, transactions, stockFilter])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const paginated = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function pageNumbers(): (number | '…')[] {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
    if (page <= 4) return [1, 2, 3, 4, 5, '…', pageCount]
    if (page >= pageCount - 3) return [1, '…', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
    return [1, '…', page - 1, page, page + 1, '…', pageCount]
  }

  return (
    <>
    <CatalogSyncOverlay open={refreshing} progress={syncProgress} />
    <Dialog.Root open={open} onOpenChange={setOpen}>
    <div className="flex-1 overflow-y-auto px-3 py-4 md:px-4 md:py-6 min-w-0 pb-28 md:pb-6">
    <div className="w-full">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5 md:mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">Catalog, pricing, and stock levels</p>
        </div>
        <div className="flex flex-col gap-2 w-full md:w-auto md:flex-row md:items-center">
          <button
            type="button"
            onClick={openAdd}
            className="md:hidden inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus size={18} />
            Add product
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshCatalogFromServer}
              disabled={refreshing}
              title="Sync catalog"
              className="inline-flex flex-1 md:flex-none items-center justify-center gap-1.5 border border-gray-300 text-gray-700 px-3 py-2.5 md:py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{refreshing ? 'Syncing…' : 'Sync catalog'}</span>
              <span className="sm:hidden">{refreshing ? '…' : 'Sync'}</span>
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="inline-flex flex-1 md:flex-none items-center justify-center gap-1.5 border border-gray-300 text-gray-700 px-3 py-2.5 md:py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <Upload size={16} />
              <span className="hidden sm:inline">Bulk upload</span>
              <span className="sm:hidden">Bulk</span>
            </button>
            <Dialog.Trigger asChild>
              <button
                onClick={openAdd}
                className="hidden md:inline-flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Plus size={16} />
                Add product
              </button>
            </Dialog.Trigger>
          </div>
        </div>
      </div>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
            <Dialog.Content className="fixed z-50 bg-white shadow-2xl focus:outline-none overflow-y-auto max-h-[92vh] sm:max-h-[90vh] inset-x-0 bottom-0 rounded-t-2xl p-5 pb-8 w-full sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6 sm:w-full sm:max-w-md">
              <div className="flex items-center justify-between mb-5">
                <Dialog.Title className="text-lg font-semibold">{editingProduct ? 'Edit product' : 'Add product'}</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="text-gray-500 hover:text-gray-600 rounded-md p-1"><X size={18} /></button>
                </Dialog.Close>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="space-y-1.5 order-1 sm:order-2">
                  <Label.Root htmlFor="p-name" className="text-sm font-medium text-gray-700">Name</Label.Root>
                  <input id="p-name" required value={form.name} onChange={handleNameChange} onBlur={handleNameBlur}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  {dupWarning.length > 0 && (
                    <p className="text-xs text-amber-600">
                      Similar product already exists: {dupWarning.join(', ')}
                    </p>
                  )}
                </div>

                <div className="order-2 sm:order-1">
                  <ProductImageField
                    imageUrl={form.imageUrl}
                    uploading={uploading}
                    onFile={uploadProductImage}
                    onClear={() => setForm((f) => ({ ...f, imageUrl: '' }))}
                  />
                </div>

                <div className="space-y-1.5 order-3">
                  <Label.Root htmlFor={editingProduct ? 'p-sku' : undefined} className="text-sm font-medium text-gray-700">SKU</Label.Root>
                  {editingProduct ? (
                    <input id="p-sku" required value={form.sku} onChange={handleSkuChange}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  ) : (
                    <p className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-600 bg-gray-50">
                      {form.sku || <span className="text-gray-400 font-sans">Generated from product name</span>}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 order-3">
                  <div className="space-y-1.5">
                    <Label.Root htmlFor="p-spec" className="text-sm font-medium text-gray-700">Specification / Size <span className="text-gray-400 font-normal">(optional)</span></Label.Root>
                    <input id="p-spec" value={form.specification} onChange={handleSpecChange}
                      placeholder="e.g. 250ml, 32mm, 3/4&quot;"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1.5">
                    <Label.Root htmlFor="p-unit" className="text-sm font-medium text-gray-700">Stock Unit</Label.Root>
                    <input id="p-unit" value={form.stockUnit} onChange={field('stockUnit')}
                      placeholder="e.g. pcs, box, pkt, roll"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 order-3">
                  <div className="space-y-1.5">
                    <Label.Root htmlFor="p-sell" className="text-sm font-medium text-gray-700">Selling price</Label.Root>
                    <input id="p-sell" required type="number" min="0" step="0.01" value={form.sellingPrice} onChange={field('sellingPrice')}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1.5">
                    <Label.Root htmlFor="p-cost" className="text-sm font-medium text-gray-700">Cost price</Label.Root>
                    <input id="p-cost" required type="number" min="0" step="0.01" value={form.costPrice} onChange={field('costPrice')}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>

                <div className="space-y-1.5 order-3">
                  <Label.Root htmlFor="p-lowest" className="text-sm font-medium text-gray-700">
                    Lowest price <span className="text-gray-400 font-normal">(optional stricter floor)</span>
                  </Label.Root>
                  <input id="p-lowest" type="number" min="0" step="0.01" value={form.lowestPrice} onChange={field('lowestPrice')}
                    placeholder="Leave blank to use pricing rule from Settings"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <p className="text-xs text-gray-400">
                    Discount floor defaults to cost × markup% (Settings). Set this only to enforce a higher minimum than the rule.
                  </p>
                </div>

                {!editingProduct ? (
                  <div className="space-y-1.5 order-3">
                    <Label.Root htmlFor="p-stock" className="text-sm font-medium text-gray-700">
                      Opening stock <span className="text-gray-400 font-normal">(units you have right now)</span>
                    </Label.Root>
                    <input id="p-stock" type="number" min="0" step="1" value={form.openingStock} onChange={field('openingStock')}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                ) : (
                  <div className="space-y-1.5 order-3">
                    {(() => {
                      const currentStock = computeStock(editingProduct.id, transactions, editingProduct.initialStock ?? 0)
                      return (
                        <>
                          <div className="flex items-center justify-between">
                            <Label.Root htmlFor="p-addstock" className="text-sm font-medium text-gray-700">Add stock</Label.Root>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${currentStock <= 0 ? 'bg-red-100 text-red-700' : currentStock < 5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                              Currently: {currentStock} {editingProduct.stockUnit ?? 'units'}
                            </span>
                          </div>
                          <input id="p-addstock" type="number" min="1" step="1" value={form.addStock} onChange={field('addStock')}
                            placeholder="Enter qty to add (optional)"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </>
                      )
                    })()}
                  </div>
                )}

                <div className="space-y-1.5 order-3">
                  <Label.Root className="text-sm font-medium text-gray-700">Category</Label.Root>
                  {categories.length > 0 ? (
                    <Select.Root value={form.categoryId} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v, newCategory: '' }))}>
                      <Select.Trigger className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <Select.Value placeholder="Select or type a new one below" />
                        <Select.Icon><ChevronDown size={16} className="text-gray-500" /></Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className="bg-white border border-gray-200 rounded-xl shadow-lg z-[60] overflow-hidden">
                          <Select.Viewport className="p-1">
                            {categories.map((c) => (
                              <Select.Item key={c.id} value={c.id}
                                className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                                <Select.ItemText>{c.name}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  ) : null}
                  {!form.categoryId && (
                    <input
                      placeholder="Or type a new category name"
                      value={form.newCategory}
                      onChange={field('newCategory')}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>

                <div className="flex gap-2 pt-1 justify-end order-3 sm:sticky sm:bottom-0 sm:bg-white sm:pt-2">
                  <Dialog.Close asChild>
                    <button type="button" className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                  </Dialog.Close>
                  <button type="submit" disabled={saving}
                    className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving…' : editingProduct ? 'Update' : 'Save'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>

      <BulkUploadWizard
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onComplete={() => loadCatalog()}
      />

      {lowStockCount > 0 && stockFilter === 'all' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800 flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            {lowStockCount} product{lowStockCount === 1 ? '' : 's'} running low — restock inline below.
          </p>
          <button
            onClick={() => setStockFilterAndReset('low')}
            className="text-xs font-medium text-amber-900 underline hover:no-underline shrink-0"
          >
            Show low stock
          </button>
        </div>
      )}

      {missingPriceCount > 0 && stockFilter === 'all' && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">
            {missingPriceCount} product{missingPriceCount === 1 ? '' : 's'} need pricing — update cost or selling price.
          </p>
          <button
            onClick={() => { setFilterMissingPrices(true); setFilter('all'); setStockFilter('all'); setAddedFilter('all'); setPage(1) }}
            className="text-xs font-medium text-amber-900 underline hover:no-underline shrink-0"
          >
            Show missing
          </button>
        </div>
      )}

      <div className="flex gap-2 items-stretch mb-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name, SKU or specification…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
          />
          {search && (
            <button onClick={() => handleSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        {categories.length > 0 && (
          <CategoryPicker
            categories={categories}
            counts={categoryCounts}
            value={filterCategoryId}
            onChange={(id) => { setFilter(id); setPage(1) }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex flex-wrap gap-1">
          {(['all', 'low', 'out'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStockFilterAndReset(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                stockFilter === f
                  ? f === 'out' ? 'bg-red-600 text-white' : f === 'low' ? 'bg-amber-600 text-white' : 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f === 'all' ? 'All stock' : f === 'low' ? `Low stock${lowStockCount > 0 ? ` (${lowStockCount})` : ''}` : 'Out of stock'}
            </button>
          ))}
          {missingPriceCount > 0 && (
            <button
              onClick={() => { setFilterMissingPrices(true); setFilter('all'); setStockFilter('all'); setAddedFilter('all'); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filterMissingPrices ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}`}
            >
              Missing prices ({missingPriceCount})
            </button>
          )}
        </div>
        <div className="hidden sm:block w-px h-5 bg-gray-200" />
        <div className="flex flex-wrap gap-1">
          {ADDED_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setAddedFilterAndReset(r.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                addedFilter === r.value
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-auto">
          {visible.length.toLocaleString()} product{visible.length === 1 ? '' : 's'}
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          {search || stockFilter !== 'all' || addedFilter !== 'all' || filterMissingPrices || filterCategoryId !== 'all' ? (
            <>
              <p className="text-sm font-medium">No products match your filters</p>
              <button
                onClick={() => {
                  handleSearch('')
                  setFilter('all')
                  setStockFilterAndReset('all')
                  setAddedFilterAndReset('all')
                  setFilterMissingPrices(false)
                }}
                className="mt-2 text-xs text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            </>
          ) : (
            <p className="text-sm">No products yet — add your first one</p>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl">
          {/* Desktop Table View */}
          <div className="hidden md:block">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-11" />
                <col />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[6%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[6%]" />
                <col className="w-[10%]" />
                <col className="w-9" />
              </colgroup>
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-3"></th>
                  <th className="text-left px-3 py-3">Name</th>
                  <th className="text-left px-3 py-3">Spec / Size</th>
                  <th className="text-left px-3 py-3">SKU</th>
                  <th className="text-left px-3 py-3">Category</th>
                  <th className="text-right px-3 py-3">In stock</th>
                  <th className="text-right px-3 py-3">Sell</th>
                  <th className="text-right px-3 py-3">Lowest</th>
                  <th className="text-right px-3 py-3">Discount</th>
                  <th className="text-right px-3 py-3">Cost</th>
                  <th className="px-3 py-3 text-right">Add stock</th>
                  <th className="px-2 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(({ product: p, stock }) => {
                  const isLow = stock < LOW_STOCK_THRESHOLD
                  return (
                  <tr key={p.id} className={`hover:bg-gray-50 ${isLow ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-3 py-2.5">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.name} className="w-9 h-9 rounded-md object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-gray-100 flex items-center justify-center">
                          <Camera size={14} className="text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-medium truncate" title={p.name}>{p.name}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 truncate">
                      {p.specification && <span className="font-medium text-gray-700">{p.specification}</span>}
                      {p.specification && p.stockUnit && <span className="text-gray-400"> · </span>}
                      {p.stockUnit && <span className="text-gray-400">{p.stockUnit}</span>}
                      {!p.specification && !p.stockUnit && <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-500 truncate" title={p.sku}>{p.sku}</td>
                    <td className="px-3 py-2.5 text-gray-500 truncate" title={categoryMap[p.categoryId]}>{categoryMap[p.categoryId] ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${stock <= 0 ? 'bg-red-100 text-red-700' : isLow ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                        {stock <= 0 ? 'Out' : stock.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{p.sellingPrice.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-amber-700 text-xs tabular-nums">
                      {p.sellingPrice > 0 && p.costPrice > 0 ? (
                        <>
                          {effectiveLowestPrice(p, minMarkupPercent).toLocaleString()}
                          {p.lowestPrice != null && p.lowestPrice > p.costPrice * (minMarkupPercent / 100) && (
                            <span className="block text-[10px] text-gray-400 font-normal">manual floor</span>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      {p.sellingPrice > 0 && p.costPrice > 0 ? (() => {
                        const maxDisc = maxDiscountPerUnit(p, minMarkupPercent)
                        const pct = p.sellingPrice > 0 ? Math.round((maxDisc / p.sellingPrice) * 100) : 0
                        return maxDisc > 0 ? (
                          <span className="text-emerald-700 font-medium">
                            {maxDisc.toLocaleString()}
                            <span className="text-gray-400 font-normal ml-1">({pct}%)</span>
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )
                      })() : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-500 tabular-nums">{p.costPrice.toLocaleString()}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 justify-end">
                        <input
                          type="number"
                          min="1"
                          placeholder="Qty"
                          value={restockQtys[p.id] ?? ''}
                          onChange={(e) => setRestockQtys((r) => ({ ...r, [p.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && handleRestock(p)}
                          className="w-12 border border-gray-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleRestock(p)}
                          disabled={restocking[p.id] || !restockQtys[p.id]}
                          className="px-1.5 py-1 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors whitespace-nowrap"
                        >
                          {restocking[p.id] ? '…' : '+'}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                        <Pencil size={14} />
                      </button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-gray-100">
            {paginated.map(({ product: p, stock }) => {
              const isLow = stock < LOW_STOCK_THRESHOLD
              return (
                <div key={p.id} className={`p-4 ${isLow ? 'bg-amber-50/40' : ''}`}>
                  <div className="flex items-start gap-3">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <Camera size={20} className="text-gray-400" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">{p.name}</h3>
                        <button onClick={() => openEdit(p)} className="p-1 -mr-1 text-gray-400 hover:text-blue-600">
                          <Pencil size={16} />
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 font-mono">{p.sku}</p>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className={`font-semibold px-2 py-0.5 rounded-full ${stock <= 0 ? 'bg-red-100 text-red-700' : isLow ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                          {stock <= 0 ? 'Out of stock' : `${stock.toLocaleString()} ${p.stockUnit ?? 'units'}`}
                        </span>
                        <span className="font-medium text-gray-900">{p.sellingPrice.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Add Qty"
                      value={restockQtys[p.id] ?? ''}
                      onChange={(e) => setRestockQtys((r) => ({ ...r, [p.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleRestock(p)}
                      className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleRestock(p)}
                      disabled={restocking[p.id] || !restockQtys[p.id]}
                      className="px-4 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
                    >
                      {restocking[p.id] ? 'Adding…' : 'Add Stock'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, visible.length)} of {visible.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={15} />
            </button>

            {pageNumbers().map((n, i) =>
              n === '…' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-gray-400 text-sm select-none">…</span>
              ) : (
                <button
                  key={n}
                  onClick={() => setPage(n)}
                  className={`min-w-[32px] h-8 rounded-lg text-xs font-medium transition-colors ${
                    page === n
                      ? 'bg-blue-600 text-white'
                      : 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {n}
                </button>
              )
            )}

            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === pageCount}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
    </Dialog.Root>
    </>
  )
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="flex-1 p-6 text-sm text-gray-500">Loading products…</div>}>
      <ProductsPageContent />
    </Suspense>
  )
}
