'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BrandPicker } from '@/components/pos/BrandPicker'
import { CategoryPicker } from '@/components/pos/CategoryPicker'
import * as Dialog from '@radix-ui/react-dialog'
import * as Select from '@radix-ui/react-select'
import { AlertCircle, ChevronDown, FileText, ImageOff, Minus, Plus, Printer, Search, ShoppingCart, Trash2, WifiOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { createMany as createManyTransactions } from '@/lib/db/transactions'
import { drain } from '@/lib/db/syncQueue'
import { drain as drainProductSync } from '@/lib/db/productSyncQueue'
import { create as createSale, type Sale } from '@/lib/db/sales'
import { push as pushSale, drain as drainSales } from '@/lib/db/salesSyncQueue'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { normalizeQuery } from '@/lib/normalize'
import { getAll as getTransactions } from '@/lib/db/transactions'
import { createMany as createManyIncidents, pushMany as pushManyIncidents, drain as drainIncident } from '@/lib/db/incidents'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { buildStockByProductId, getLowStockItems, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import { getBrandOptions, getProductBrand, matchesProductSearch } from '@/lib/brands'
import { barcodeSearchEnabled, findProductByExactBarcode } from '@/lib/product-search'
import { getDeviceId } from '@/lib/device'
import { INCIDENT_REASON_LABELS } from '@/lib/types'
import { fetchSettings, type PosLookupMode } from '@/lib/settings'
import { canDiscount, clampUnitPrice, DEFAULT_MIN_MARKUP_PERCENT, discountPerUnit, effectiveLowestPrice } from '@/lib/pricing'
import { applyCartDiscount, maxCartDiscount } from '@/lib/pricing-cart'
import { getCachedAuthUser } from '@/lib/auth'
import { getMyBranchId } from '@/lib/branch'
import type { Product, ProductCategory, InventoryTransaction, IncidentReason, SaleLine } from '@/lib/types'

type CartItem = Product & { qty: number; unitPrice: number }

interface QuoteForm {
  customerName: string
  customerPhone: string
  note: string
}

interface IncidentDraft {
  productId: string
  productName: string
  reason: IncidentReason
  note: string
}

export default function POSPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [allTransactions, setAllTransactions] = useState<InventoryTransaction[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all')
  const [activeBrand, setActiveBrand] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [productPage, setProductPage] = useState(1)
  const POS_PAGE_SIZE = 48
  const [cart, setCart] = useState<CartItem[]>([])
  const [offline, setOffline] = useState(false)
  const [receipt, setReceipt] = useState<{ orderId: string; items: CartItem[]; total: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [quoteForm, setQuoteForm] = useState<QuoteForm>({ customerName: '', customerPhone: '', note: '' })
  const [quoteSending, setQuoteSending] = useState(false)
  // Incident modal
  const [incidentOpen, setIncidentOpen] = useState(false)
  const [incidentSearch, setIncidentSearch] = useState('')
  const [incidentDrafts, setIncidentDrafts] = useState<IncidentDraft[]>([])
  const [incidentSaving, setIncidentSaving] = useState(false)
  const [minMarkupPercent, setMinMarkupPercent] = useState(DEFAULT_MIN_MARKUP_PERCENT)
  const [posLookupMode, setPosLookupMode] = useState<PosLookupMode>('catalog')
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [cartDiscountInput, setCartDiscountInput] = useState('')
  const [cartDiscountApplied, setCartDiscountApplied] = useState(0)
  const alertedIds = useRef<Set<string>>(new Set())
  const skipCartPersist = useRef(true)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastBarcodeAdd = useRef('')

  // Restore cart from localStorage after mount (avoids SSR/client hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pos_cart')
      if (saved) {
        const parsed = JSON.parse(saved) as CartItem[]
        queueMicrotask(() => setCart(parsed))
      }
    } catch { /* ignore */ }
  }, [])

  // Persist cart across navigation
  useEffect(() => {
    if (skipCartPersist.current) {
      skipCartPersist.current = false
      return
    }
    const persistTimer = window.setTimeout(() => {
      try {
        localStorage.setItem('pos_cart', JSON.stringify(cart))
      } catch { /* storage full — ignore */ }
    }, 400)
    return () => window.clearTimeout(persistTimer)
  }, [cart])

  useEffect(() => {
    const onOnline = () => { setOffline(false); drain().catch(() => {}); drainProductSync().catch(() => {}); drainIncident().catch(() => {}); drainSales().catch(() => {}) }
    const onOffline = () => setOffline(true)
    queueMicrotask(() => setOffline(!navigator.onLine))
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    drain().catch(() => {})
    drainProductSync().catch(() => {})
    drainIncident().catch(() => {})
    drainSales().catch(() => {})
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    fetchSettings().then((s) => {
      setMinMarkupPercent(s.minMarkupPercent)
      setPosLookupMode(s.posLookupMode)
    }).catch(() => {})
  }, [])

  const barcodeEnabled = barcodeSearchEnabled(posLookupMode)
  const showCatalogFilters = posLookupMode !== 'barcode'
  const searchPlaceholder = barcodeEnabled
    ? 'Scan barcode or search…'
    : 'Search by name, SKU, brand, category or size…'

  useEffect(() => {
    if (!barcodeEnabled) return
    searchInputRef.current?.focus()
  }, [barcodeEnabled])

  useEffect(() => {
    let cancelled = false

    const applySnapshot = (cats: ProductCategory[], prods: Product[], txs: InventoryTransaction[]) => {
      if (cancelled) return
      setCategories(cats)
      setProducts(prods)
      setAllTransactions(txs)

      const stockByProductId = buildStockByProductId(prods, txs)
      const low = getLowStockItems(prods, txs, stockByProductId)
      low.forEach(({ product }) => alertedIds.current.add(product.id))
      if (low.length === 1) {
        toast.warning(`Low stock: ${low[0].product.name}`, {
          description: `Only ${low[0].stock} unit${low[0].stock !== 1 ? 's' : ''} left — check Reports`,
          duration: 5000,
        })
      } else if (low.length > 1) {
        toast.warning(`${low.length} items are low on stock`, {
          description: 'Visit Reports to see the full list and restock.',
          duration: 5000,
        })
      }
    }

    async function load() {
      let [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      if (prods.length === 0) {
        await seedIfEmpty()
        ;[cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      }
      applySnapshot(cats, prods, txs)

      // Keep initial paint responsive and sync in the background.
      void syncFromServer().then(async (synced) => {
        if (!synced || cancelled) return
        const [nextCats, nextProds, nextTxs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
        applySnapshot(nextCats, nextProds, nextTxs)
      })
    }

    void load()
    return () => { cancelled = true }
  }, [])

  const deferredSearch = useDeferredValue(search)
  const nq = normalizeQuery(deferredSearch.trim())
  const stockByProductId = useMemo(
    () => buildStockByProductId(products, allTransactions),
    [products, allTransactions],
  )
  const brands = useMemo(() => getBrandOptions(products), [products])
  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const product of products) {
      const brand = getProductBrand(product)
      counts[brand] = (counts[brand] ?? 0) + 1
    }
    return counts
  }, [products])
  const searchableProducts = useMemo(
    () =>
      products.map((product) => ({
        product,
        nameN: normalizeQuery(product.name),
        skuN: normalizeQuery(product.sku),
        specN: normalizeQuery(product.specification ?? ''),
        barcodeN: product.barcode ? normalizeQuery(product.barcode) : '',
        brand: getProductBrand(product),
        brandN: normalizeQuery(getProductBrand(product)),
      })),
    [products],
  )
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
    return counts
  }, [products])

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const visible = useMemo(
    () =>
      searchableProducts
        .filter(({ product }) => activeCategoryId === 'all' || product.categoryId === activeCategoryId)
        .filter(({ brand }) => activeBrand === 'all' || brand === activeBrand)
        .filter(
          ({ product, nameN, skuN, specN, brandN, barcodeN }) =>
            !nq ||
            nameN.includes(nq) ||
            skuN.includes(nq) ||
            specN.includes(nq) ||
            brandN.includes(nq) ||
            (barcodeEnabled && barcodeN.includes(nq)) ||
            matchesProductSearch(product, nq, categoryMap[product.categoryId] ?? '', {
              includeBarcode: barcodeEnabled,
            }),
        )
        .map(({ product }) => product),
    [searchableProducts, activeCategoryId, activeBrand, nq, categoryMap, barcodeEnabled],
  )

  const productPageCount = Math.max(1, Math.ceil(visible.length / POS_PAGE_SIZE))
  const paginatedVisible = visible.slice(
    (productPage - 1) * POS_PAGE_SIZE,
    productPage * POS_PAGE_SIZE,
  )

  function setCategory(id: string) {
    setActiveCategoryId(id)
    setProductPage(1)
  }

  function setBrand(brand: string) {
    setActiveBrand(brand)
    setProductPage(1)
  }

  function setSearchQuery(q: string) {
    setSearch(q)
    setProductPage(1)
    if (!q.trim()) lastBarcodeAdd.current = ''
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id)
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { ...product, qty: 1, unitPrice: product.sellingPrice }]
    })
  }

  function handleProductClick(product: Product) {
    const stock = stockByProductId[product.id] ?? (product.initialStock ?? 0)
    if (stock < LOW_STOCK_THRESHOLD) {
      router.push(`/products?restock=${encodeURIComponent(product.id)}`)
      return
    }
    addToCart(product)
  }

  function tryBarcodeAdd(raw: string): boolean {
    const match = findProductByExactBarcode(products, raw)
    if (!match) return false
    const key = `${match.id}:${raw}`
    if (lastBarcodeAdd.current === key) return true
    lastBarcodeAdd.current = key
    const stock = stockByProductId[match.id] ?? (match.initialStock ?? 0)
    if (stock < LOW_STOCK_THRESHOLD) {
      router.push(`/products?restock=${encodeURIComponent(match.id)}`)
    } else {
      addToCart(match)
      toast.success(`Added ${match.name}`)
    }
    setSearchQuery('')
    return true
  }

  useEffect(() => {
    if (!barcodeEnabled) return
    const raw = deferredSearch.trim()
    if (!raw) {
      lastBarcodeAdd.current = ''
      return
    }
    tryBarcodeAdd(raw)
  }, [deferredSearch, products, barcodeEnabled, stockByProductId, router])

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !barcodeEnabled) return
    const raw = search.trim()
    if (!raw) return
    if (tryBarcodeAdd(raw)) {
      e.preventDefault()
      return
    }
    if (posLookupMode === 'barcode') {
      e.preventDefault()
      toast.error('No product found for this barcode')
    }
  }

  function setQty(id: string, delta: number) {
    setCart((prev) =>
      prev.map((i) => i.id === id ? { ...i, qty: i.qty + delta } : i).filter((i) => i.qty > 0)
    )
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((i) => i.id !== id))
    setPriceDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function clearPriceDraft(id: string) {
    setPriceDrafts((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function commitItemPriceDraft(id: string) {
    const draft = priceDrafts[id]
    if (draft === undefined) return
    setItemPrice(id, draft)
    clearPriceDraft(id)
  }

  function setItemPrice(id: string, raw: string) {
    const val = parseFloat(raw)
    if (isNaN(val)) return
    setCart((prev) => prev.map((item) => {
      if (item.id !== id) return item
      const min = effectiveLowestPrice(item, minMarkupPercent)
      const clamped = clampUnitPrice(item, val, minMarkupPercent)
      if (val < min) {
        toast.warning(`Min price for ${item.name} is KES ${min.toLocaleString()}`)
      }
      return { ...item, unitPrice: clamped }
    }))
  }

  function applyDiscountPercent(id: string, percent: number) {
    clearPriceDraft(id)
    setCart((prev) => prev.map((item) => {
      if (item.id !== id) return item
      const target = item.sellingPrice * (1 - percent / 100)
      return { ...item, unitPrice: clampUnitPrice(item, target, minMarkupPercent) }
    }))
  }

  function resetItemPrice(id: string) {
    clearPriceDraft(id)
    setCart((prev) => prev.map((item) =>
      item.id === id ? { ...item, unitPrice: item.sellingPrice } : item
    ))
  }

  function applyCartDiscountAmount(raw: string) {
    const requested = parseFloat(raw)
    if (isNaN(requested) || requested <= 0) {
      setCartDiscountApplied(0)
      setCartDiscountInput('')
      return
    }
    const cartLines = cart.map((item) => ({
      sellingPrice: item.sellingPrice,
      costPrice: item.costPrice,
      lowestPrice: item.lowestPrice,
      unitPrice: item.unitPrice,
      qty: item.qty,
    }))
    const maxAllowed = maxCartDiscount(cartLines, minMarkupPercent)
    const { lines, applied } = applyCartDiscount(cartLines, requested, minMarkupPercent)
    if (requested > maxAllowed) {
      toast.warning(`Max discount: KES ${Math.round(maxAllowed).toLocaleString()}`)
    }
    setCart((prev) => prev.map((item, i) => ({ ...item, unitPrice: lines[i].unitPrice })))
    setCartDiscountApplied(applied)
    setCartDiscountInput(String(Math.round(applied)))
  }

  const subtotal = cart.reduce((sum, i) => sum + i.unitPrice * i.qty, 0)
  const listTotal = cart.reduce((sum, i) => sum + i.sellingPrice * i.qty, 0)
  const lineDiscountTotal = listTotal - subtotal
  const totalDiscount = lineDiscountTotal
  const maxCartDisc = cart.length > 0
    ? maxCartDiscount(cart.map((item) => ({
        sellingPrice: item.sellingPrice,
        costPrice: item.costPrice,
        lowestPrice: item.lowestPrice,
        unitPrice: item.unitPrice,
        qty: item.qty,
      })), minMarkupPercent)
    : 0
  async function checkout() {
    setChecking(true)
    const auth = getCachedAuthUser()
    const branchId = getMyBranchId()
    if (!auth || !branchId) {
      toast.error('Not signed in')
      setChecking(false)
      return
    }

    const saleId = crypto.randomUUID()
    const now = new Date().toISOString()
    const deviceId = getDeviceId()

    const lines: SaleLine[] = cart.map((item) => ({
      id: crypto.randomUUID(),
      productId: item.id,
      quantity: item.qty,
      unitPrice: item.unitPrice,
      originalUnitPrice: item.sellingPrice,
      lineDiscountAmount: discountPerUnit(item.sellingPrice, item.unitPrice) * item.qty,
    }))

    const sale: Sale = {
      id: saleId,
      branchId,
      deviceId,
      cashierId: auth.userId,
      subtotal: listTotal,
      lineDiscountTotal,
      saleDiscountAmount: cartDiscountApplied,
      total: subtotal - cartDiscountApplied,
      createdAt: now,
      lines,
    }

    const newTxs: InventoryTransaction[] = lines.map((line) => ({
      id: line.id,
      type: 'SALE',
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      originalUnitPrice: line.originalUnitPrice,
      lineDiscountAmount: line.lineDiscountAmount,
      saleId,
      orderId: saleId,
      branchId,
      createdAt: now,
    }))

    await createSale(sale)
    await pushSale(sale)
    await createManyTransactions(newTxs)

    const updatedTxs = [...allTransactions, ...newTxs]
    setAllTransactions(updatedTxs)
    setReceipt({ orderId: saleId, items: [...cart], total: sale.total })
    setCart([])
    setCartDiscountInput('')
    setCartDiscountApplied(0)
    localStorage.removeItem('pos_cart')
    setChecking(false)
    drainSales().catch(() => {})
    drain().catch(() => {})

    const updatedStockByProductId = buildStockByProductId(products, updatedTxs)
    const nowLow = getLowStockItems(products, updatedTxs, updatedStockByProductId)
    const newlyLow = nowLow.filter(({ product }) => !alertedIds.current.has(product.id))
    newlyLow.forEach(({ product }) => alertedIds.current.add(product.id))

    const TOAST_LIMIT = 3
    newlyLow.slice(0, TOAST_LIMIT).forEach(({ product, stock }) => {
      toast.warning(`Low stock: ${product.name}`, {
        description: `Only ${stock} unit${stock !== 1 ? 's' : ''} remaining`,
        duration: 7000,
      })
    })
    if (newlyLow.length > TOAST_LIMIT) {
      toast.warning(`${newlyLow.length - TOAST_LIMIT} more items just went low`, {
        description: 'Visit Reports to see the full list.',
        duration: 7000,
      })
    }

    if (newlyLow.length > 0) {
      fetch('/api/alerts/low-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: newlyLow.map(({ product, stock }) => ({
            name: product.name,
            sku: product.sku,
            stock,
          })),
        }),
      }).catch(() => {})
    }
  }

  async function buildReceiptDoc() {
    if (!receipt) return null
    const { generateReceiptPDF } = await import('@/lib/pdf')
    return generateReceiptPDF({
      orderId: receipt.orderId,
      total: receipt.total,
      date: new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }),
      items: receipt.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
    })
  }

  async function handlePrintReceipt() {
    const doc = await buildReceiptDoc()
    if (!doc) return
    const { printPDF } = await import('@/lib/pdf')
    printPDF(doc)
    setReceipt(null)
  }

  async function handleGenerateQuote() {
    if (!quoteForm.customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    setQuoteSending(true)
    try {
      const { generateQuotationPDF, printPDF } = await import('@/lib/pdf')
      const quoteRef = `QT-${Date.now().toString(36).toUpperCase()}`
      const doc = generateQuotationPDF({
        customerName: quoteForm.customerName,
        customerPhone: quoteForm.customerPhone || undefined,
        note: quoteForm.note || undefined,
        quoteRef,
        date: new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }),
        // Use negotiated unitPrice (not sellingPrice) in the quote
        items: cart.map((i) => ({
          name: i.name,
          sku: i.sku,
          specification: i.specification,
          stockUnit: i.stockUnit,
          qty: i.qty,
          unitPrice: i.unitPrice,
        })),
      })
      printPDF(doc)
      toast.success('Sent to printer', { description: `Ref: ${quoteRef}` })
      setQuoteOpen(false)
      setQuoteForm({ customerName: '', customerPhone: '', note: '' })
    } finally {
      setQuoteSending(false)
    }
  }

  // Incidents
  const incidentNq = normalizeQuery(incidentSearch.trim())
  const incidentProducts = useMemo(
    () =>
      searchableProducts
        .filter(({ nameN, skuN }) => !incidentNq || nameN.includes(incidentNq) || skuN.includes(incidentNq))
        .map(({ product }) => product),
    [searchableProducts, incidentNq],
  )

  function toggleIncidentProduct(p: Product) {
    setIncidentDrafts((prev) => {
      if (prev.find((d) => d.productId === p.id)) {
        return prev.filter((d) => d.productId !== p.id)
      }
      return [...prev, { productId: p.id, productName: p.name, reason: 'OUT_OF_STOCK', note: '' }]
    })
  }

  function selectAllIncidentProducts() {
    const visible = incidentProducts
    const allSelected = visible.every((p) => incidentDrafts.find((d) => d.productId === p.id))
    if (allSelected) {
      const visibleIds = new Set(visible.map((p) => p.id))
      setIncidentDrafts((prev) => prev.filter((d) => !visibleIds.has(d.productId)))
    } else {
      setIncidentDrafts((prev) => {
        const existing = new Set(prev.map((d) => d.productId))
        const toAdd = visible
          .filter((p) => !existing.has(p.id))
          .map((p) => ({ productId: p.id, productName: p.name, reason: 'OUT_OF_STOCK' as IncidentReason, note: '' }))
        return [...prev, ...toAdd]
      })
    }
  }

  function updateDraft(productId: string, patch: Partial<IncidentDraft>) {
    setIncidentDrafts((prev) => prev.map((d) => d.productId === productId ? { ...d, ...patch } : d))
  }

  async function handleSaveIncidents() {
    if (incidentDrafts.length === 0) {
      toast.error('Select at least one product')
      return
    }
    setIncidentSaving(true)
    try {
      const deviceId = getDeviceId()
      const now = new Date().toISOString()
      const incidents = incidentDrafts.map((draft) => ({
        id: crypto.randomUUID(),
        productId: draft.productId,
        productName: draft.productName,
        reason: draft.reason,
        note: draft.note || undefined,
        deviceId,
        createdAt: now,
      }))
      await createManyIncidents(incidents)
      await pushManyIncidents(incidents)
      drainIncident().catch(() => {})
      toast.success(`${incidentDrafts.length} missed sale${incidentDrafts.length !== 1 ? 's' : ''} logged`)
      setIncidentOpen(false)
      setIncidentDrafts([])
      setIncidentSearch('')
    } finally {
      setIncidentSaving(false)
    }
  }

  const reasonOptions = Object.entries(INCIDENT_REASON_LABELS) as [IncidentReason, string][]

  return (
    <div className="flex flex-col md:flex-row flex-1 h-screen overflow-hidden">
      {offline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs px-3 py-1.5 rounded-full shadow">
          <WifiOff size={13} />
          Offline — changes saved locally
        </div>
      )}

      {/* Left: product area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 md:px-6 pt-4 md:pt-6 pb-2 shrink-0">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight mb-2 md:mb-4">Point of Sale</h1>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <div className="relative flex-1 min-w-0 w-full">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={searchPlaceholder}
                className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
              />
              {search && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              )}
            </div>
            {showCatalogFilters && (categories.length > 0 || brands.length > 0) && (
              <div className={`grid gap-2 min-w-0 sm:flex sm:shrink-0 ${categories.length > 0 && brands.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {categories.length > 0 && (
                  <CategoryPicker
                    categories={categories}
                    counts={categoryCounts}
                    value={activeCategoryId}
                    onChange={setCategory}
                  />
                )}
                {brands.length > 0 && (
                  <BrandPicker
                    brands={brands}
                    counts={brandCounts}
                    value={activeBrand}
                    onChange={setBrand}
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>
              {visible.length.toLocaleString()} product{visible.length === 1 ? '' : 's'}
              {activeCategoryId !== 'all' && categoryMap[activeCategoryId]
                ? ` in ${categoryMap[activeCategoryId]}`
                : ''}
              {activeBrand !== 'all' ? ` · ${activeBrand}` : ''}
              {nq ? ' matching search' : ''}
            </span>
            {visible.length > POS_PAGE_SIZE && (
              <span>
                Page {productPage} of {productPageCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {visible.length === 0 ? (
            <div className="text-center mt-16 space-y-2">
              <p className="text-sm text-gray-500">No products found</p>
              {(activeCategoryId !== 'all' || activeBrand !== 'all' || nq) && (
                <button
                  type="button"
                  onClick={() => { setCategory('all'); setBrand('all'); setSearchQuery('') }}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-3">
              {paginatedVisible.map((p) => {
                const stock = stockByProductId[p.id] ?? (p.initialStock ?? 0)
                const isOut = stock <= 0
                const isLow = stock < LOW_STOCK_THRESHOLD
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProductClick(p)}
                    title={isOut ? 'Out of stock — open Products to restock' : isLow ? 'Low stock — open Products to restock' : undefined}
                    className={`text-left border rounded-xl overflow-hidden transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isOut
                        ? 'border-red-300 bg-red-50 hover:border-red-400'
                        : isLow
                          ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                          : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                    }`}
                  >
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" className="w-full h-28 object-cover" />
                    ) : (
                      <div className={`w-full h-28 flex items-center justify-center ${isLow ? 'bg-amber-100/60' : 'bg-gray-100'}`}>
                        <ImageOff size={22} className="text-gray-300" />
                      </div>
                    )}
                    <div className="p-3">
                      <p className="font-medium text-sm leading-snug">{p.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{p.sku}</p>
                      {p.specification && (
                        <p className="text-xs text-gray-500 mt-0.5">{p.specification}</p>
                      )}
                      <p className="text-blue-600 font-semibold mt-2">KES {p.sellingPrice.toLocaleString()}</p>
                      {canDiscount(p, minMarkupPercent) && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Min: KES {effectiveLowestPrice(p, minMarkupPercent).toLocaleString()}
                        </p>
                      )}
                      {isLow && (
                        <p className="text-xs text-amber-600 font-medium mt-1">
                          {stock === 0 ? '⚠ Out of stock' : `⚠ ${stock} ${p.stockUnit ?? 'left'}`}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {productPageCount > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6 pb-2">
                <button
                  type="button"
                  disabled={productPage === 1}
                  onClick={() => setProductPage((p) => p - 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-gray-500 tabular-nums px-2">
                  {(productPage - 1) * POS_PAGE_SIZE + 1}–{Math.min(productPage * POS_PAGE_SIZE, visible.length)} of {visible.length.toLocaleString()}
                </span>
                <button
                  type="button"
                  disabled={productPage === productPageCount}
                  onClick={() => setProductPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
            </>
          )}
        </div>
      </div>

      {/* Right: cart */}
      <aside className="w-full md:w-80 border-t md:border-t-0 md:border-l border-gray-200 flex flex-col bg-gray-50 flex-[0_0_auto] max-h-[50vh] md:max-h-full">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200">
          <ShoppingCart size={18} className="text-gray-500" />
          <span className="font-semibold text-sm">Cart</span>
          {cart.length > 0 && (
            <span className="ml-auto text-xs bg-blue-600 text-white rounded-full px-2 py-0.5">
              {cart.reduce((s, i) => s + i.qty, 0)}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {cart.length === 0 ? (
            <p className="text-xs text-gray-500 text-center mt-8">Cart is empty</p>
          ) : (
            cart.map((item) => {
              const discountable = canDiscount(item, minMarkupPercent)
              const floor = discountable ? effectiveLowestPrice(item, minMarkupPercent) : 0
              const currentDisc = discountPerUnit(item.sellingPrice, item.unitPrice)
              const discPct = item.sellingPrice > 0 ? Math.round((currentDisc / item.sellingPrice) * 100) : 0
              const priceDraft = priceDrafts[item.id] ?? String(item.unitPrice)
              return (
                <div key={item.id} className="rounded-lg border border-gray-200 bg-white p-2.5 space-y-2">
                  <div className="flex items-start gap-1">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      {!discountable && (
                        <p className="text-xs text-gray-500 tabular-nums">
                          KES {item.unitPrice.toLocaleString()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFromCart(item.id)}
                      className="p-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                      title="Remove from cart"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {discountable && (
                    <div className="space-y-1.5 rounded-md border border-amber-100 bg-amber-50/60 px-2 py-1.5">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[11px] text-gray-500 tabular-nums">
                          List{' '}
                          <span className={item.unitPrice < item.sellingPrice ? 'line-through' : ''}>
                            KES {item.sellingPrice.toLocaleString()}
                          </span>
                        </p>
                        <p className="text-[10px] text-amber-800/80 tabular-nums shrink-0">
                          Min KES {floor.toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] text-gray-600 shrink-0">Sell at</label>
                        <input
                          type="number"
                          min={floor}
                          max={item.sellingPrice}
                          step="1"
                          value={priceDraft}
                          onChange={(e) => setPriceDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          onBlur={() => commitItemPriceDraft(item.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur()
                            }
                          }}
                          className="flex-1 min-w-0 border border-gray-200 rounded-md px-2 py-1 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[10px] text-gray-500 tabular-nums">
                          {currentDisc > 0
                            ? `−KES ${currentDisc.toLocaleString()} (${discPct}%)`
                            : 'No discount'}
                        </p>
                        {item.unitPrice < item.sellingPrice && (
                          <button
                            type="button"
                            onClick={() => resetItemPrice(item.id)}
                            className="text-[10px] text-blue-600 hover:underline shrink-0"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <div className="flex gap-1">
                        {[5, 10, 15].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => applyDiscountPercent(item.id, pct)}
                            className="flex-1 text-[10px] py-1 rounded border border-gray-200 text-gray-600 hover:bg-white hover:border-amber-300 hover:text-amber-800 transition-colors"
                          >
                            −{pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setQty(item.id, -1)} className="p-1 rounded-md hover:bg-gray-100 border border-gray-200"><Minus size={12} /></button>
                      <span className="text-sm w-6 text-center tabular-nums">{item.qty}</span>
                      <button type="button" onClick={() => setQty(item.id, 1)} className="p-1 rounded-md hover:bg-gray-100 border border-gray-200"><Plus size={12} /></button>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      KES {(item.unitPrice * item.qty).toLocaleString()}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 space-y-3">
          {totalDiscount > 0 && (
            <>
              <div className="flex justify-between text-xs text-gray-500">
                <span>List total</span>
                <span className="line-through">KES {listTotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs text-amber-600">
                <span>Discount</span>
                <span>−KES {totalDiscount.toLocaleString()}</span>
              </div>
            </>
          )}
          {cart.length > 0 && maxCartDisc > 0 && (
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Cart discount (KES)</label>
              <input
                type="number"
                min={0}
                max={maxCartDisc}
                value={cartDiscountInput}
                onChange={(e) => setCartDiscountInput(e.target.value)}
                onBlur={() => applyCartDiscountAmount(cartDiscountInput)}
                placeholder={`Max ${Math.round(maxCartDisc).toLocaleString()}`}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span>
            <span>KES {(subtotal - cartDiscountApplied).toLocaleString()}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setQuoteOpen(true)}
              disabled={cart.length === 0}
              className="flex items-center gap-1.5 border border-gray-300 px-3 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40 transition-colors"
              title="Generate quotation PDF"
            >
              <FileText size={14} />
              Quote
            </button>
            <button onClick={checkout} disabled={cart.length === 0 || checking}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors">
              {checking ? 'Processing…' : 'Checkout'}
            </button>
          </div>
          <button
            onClick={() => { setIncidentOpen(true); setIncidentDrafts([]); setIncidentSearch('') }}
            className="w-full flex items-center justify-center gap-1.5 border border-amber-300 text-amber-700 py-2 rounded-xl text-xs font-medium hover:bg-amber-50 transition-colors"
          >
            <AlertCircle size={13} />
            Log missed sale
          </button>
        </div>
      </aside>

      {/* Receipt modal */}
      <Dialog.Root open={!!receipt} onOpenChange={(v) => !v && setReceipt(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm z-50 focus:outline-none">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold">Receipt</Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-gray-500 hover:text-gray-600 p-1 rounded-md"><X size={18} /></button>
              </Dialog.Close>
            </div>
            {receipt && (
              <>
                <p className="text-xs text-gray-500 font-mono mb-4 break-all">Order {receipt.orderId}</p>
                <div className="space-y-2 mb-4">
                  {receipt.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span>{item.name} × {item.qty}</span>
                      <div className="text-right">
                        {item.unitPrice < item.sellingPrice && (
                          <span className="text-xs text-amber-600 mr-1">discounted</span>
                        )}
                        <span>KES {(item.unitPrice * item.qty).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 flex justify-between font-semibold text-sm">
                  <span>Total</span>
                  <span>KES {receipt.total.toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-5">
                  <button
                    onClick={handlePrintReceipt}
                    className="py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Printer size={14} />
                    Print
                  </button>
                  <Dialog.Close asChild>
                    <button className="border border-gray-300 py-2.5 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                      Cancel
                    </button>
                  </Dialog.Close>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Quotation modal */}
      <Dialog.Root open={quoteOpen} onOpenChange={setQuoteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm z-50 focus:outline-none">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold">Generate Quotation</Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-gray-500 hover:text-gray-600 p-1 rounded-md"><X size={18} /></button>
              </Dialog.Close>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Customer Name *</label>
                <input
                  type="text"
                  value={quoteForm.customerName}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, customerName: e.target.value }))}
                  placeholder="e.g. John Kamau"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Customer Phone (optional)</label>
                <input
                  type="tel"
                  value={quoteForm.customerPhone}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, customerPhone: e.target.value }))}
                  placeholder="e.g. 0712 345 678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Note / Terms (optional)</label>
                <textarea
                  value={quoteForm.note}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Valid for 30 days. Payment on delivery."
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                {cart.map((i) => (
                  <div key={i.id} className="flex justify-between">
                    <span>{i.name} × {i.qty}</span>
                    <span>KES {(i.unitPrice * i.qty).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold text-gray-800 border-t pt-1 mt-1">
                  <span>Total</span>
                  <span>KES {subtotal.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button
                onClick={handleGenerateQuote}
                disabled={quoteSending}
                className="py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                <Printer size={14} />
                {quoteSending ? '…' : 'Print'}
              </button>
              <Dialog.Close asChild>
                <button className="border border-gray-300 py-2.5 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Incident / Missed Sale modal */}
      <Dialog.Root open={incidentOpen} onOpenChange={setIncidentOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg z-50 focus:outline-none max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-lg font-semibold">Log Missed Sale</Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-gray-500 hover:text-gray-600 p-1 rounded-md"><X size={18} /></button>
              </Dialog.Close>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Select the product(s) a customer asked for but did not buy, then choose a reason.
            </p>

            {/* Search + select all */}
            <div className="relative mb-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={incidentSearch}
                onChange={(e) => setIncidentSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
              />
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500">{incidentDrafts.length} selected</span>
              <button
                type="button"
                onClick={selectAllIncidentProducts}
                className="text-xs text-blue-600 hover:underline"
              >
                {incidentProducts.every((p) => incidentDrafts.find((d) => d.productId === p.id))
                  ? 'Deselect all'
                  : 'Select all'
                }
              </button>
            </div>

            {/* Product list */}
            <div className="border border-gray-200 rounded-xl overflow-hidden mb-4 max-h-52 overflow-y-auto">
              {incidentProducts.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No products found</p>
              ) : (
                incidentProducts.map((p) => {
                  const draft = incidentDrafts.find((d) => d.productId === p.id)
                  const selected = !!draft
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 ${selected ? 'bg-blue-50' : ''}`}
                      onClick={() => toggleIncidentProduct(p)}
                    >
                      <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${selected ? 'border-blue-600 bg-blue-600' : 'border-gray-300'}`}>
                        {selected && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 12 12"><path d="M10 3L5 8.5 2 5.5l-1 1L5 10.5l6-7-1-0.5z"/></svg>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Reason/note per selected product */}
            {incidentDrafts.length > 0 && (
              <div className="space-y-3 mb-4">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Set reasons</p>
                {incidentDrafts.map((draft) => (
                  <div key={draft.productId} className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <p className="text-sm font-medium">{draft.productName}</p>
                    <Select.Root value={draft.reason} onValueChange={(v) => updateDraft(draft.productId, { reason: v as IncidentReason })}>
                      <Select.Trigger className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <Select.Value />
                        <Select.Icon><ChevronDown size={14} className="text-gray-500" /></Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className="bg-white border border-gray-200 rounded-xl shadow-lg z-[70] overflow-hidden">
                          <Select.Viewport className="p-1">
                            {reasonOptions.map(([value, label]) => (
                              <Select.Item key={value} value={value} className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                                <Select.ItemText>{label}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                    <input
                      type="text"
                      placeholder="Optional note…"
                      value={draft.note}
                      onChange={(e) => updateDraft(draft.productId, { note: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Dialog.Close asChild>
                <button className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              </Dialog.Close>
              <button
                onClick={handleSaveIncidents}
                disabled={incidentSaving || incidentDrafts.length === 0}
                className="flex-1 bg-amber-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-40 transition-colors"
              >
                {incidentSaving ? 'Saving…' : `Log ${incidentDrafts.length || ''} missed sale${incidentDrafts.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
