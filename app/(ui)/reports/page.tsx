'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowDownToLine, BarChart3, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Package, Percent, Printer, Receipt, Search, TrendingUp, X } from 'lucide-react'
import { BrandPicker } from '@/components/pos/BrandPicker'
import { CategoryPicker } from '@/components/pos/CategoryPicker'
import { toast } from 'sonner'
import { getAll as getTransactions } from '@/lib/db/transactions'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { getAll as getIncidents } from '@/lib/db/incidents'
import { getAll as getSales, type Sale } from '@/lib/db/sales'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { buildStockByProductId, getLowStockItems, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import { getBrandOptions, getProductBrand, matchesProductSearch } from '@/lib/brands'
import { barcodeSearchEnabled } from '@/lib/product-search'
import { normalizeQuery } from '@/lib/normalize'
import { fetchSettings, type PosLookupMode } from '@/lib/settings'
import { canViewReports, fetchMe } from '@/lib/auth'
import { getMyBranchId } from '@/lib/branch'
import { INCIDENT_REASON_LABELS } from '@/lib/types'
import type { InventoryTransaction, Product, ProductCategory, Incident } from '@/lib/types'

type Range = 'today' | 'week' | 'month' | 'all' | 'custom'
type ActivityFilter = 'all' | 'sold' | 'stocked'

const RANGES: { label: string; value: Range }[] = [
  { label: 'Today',      value: 'today' },
  { label: 'This week',  value: 'week'  },
  { label: 'This month', value: 'month' },
  { label: 'All time',   value: 'all'   },
  { label: 'Custom',     value: 'custom' },
]

function toLocalISO(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayISO(): string {
  return toLocalISO()
}

function monthStartISO(): string {
  const d = new Date()
  d.setDate(1)
  return toLocalISO(d)
}

function parseDateStart(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function parseDateEnd(iso: string): Date {
  return new Date(`${iso}T23:59:59.999`)
}

function formatDateLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function presetRangeStart(range: Exclude<Range, 'custom'>): Date {
  const d = new Date()
  if (range === 'today') { d.setHours(0, 0, 0, 0); return d }
  if (range === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d }
  if (range === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); return d }
  return new Date(0)
}

function getRangeBounds(
  range: Range,
  customFrom: string,
  customTo: string,
): { start: Date; end: Date } {
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  if (range === 'custom') {
    const fromIso = customFrom || monthStartISO()
    const toIso = customTo || todayISO()
    const [startIso, endIso] = fromIso <= toIso ? [fromIso, toIso] : [toIso, fromIso]
    return { start: parseDateStart(startIso), end: parseDateEnd(endIso) }
  }

  return { start: presetRangeStart(range), end: endOfToday }
}

function getRangeLabel(range: Range, customFrom: string, customTo: string): string {
  if (range === 'custom') {
    const fromIso = customFrom || monthStartISO()
    const toIso = customTo || todayISO()
    const [startIso, endIso] = fromIso <= toIso ? [fromIso, toIso] : [toIso, fromIso]
    if (startIso === endIso) return formatDateLabel(startIso)
    return `${formatDateLabel(startIso)} – ${formatDateLabel(endIso)}`
  }
  return RANGES.find((r) => r.value === range)?.label ?? range
}

function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso)
  return t >= start && t <= end
}

interface ReportRow {
  productId: string
  name: string
  sku: string
  specification?: string
  stockUnit?: string
  category: string
  sold: number
  stocked: number
  listRevenue: number
  revenue: number
  netStock: number
  /** Stock-in only in this period (no sales) → green row */
  isStockOnly: boolean
}

export default function ReportsPage() {
  const [range, setRange] = useState<Range>('today')
  const [customFrom, setCustomFrom] = useState(monthStartISO)
  const [customTo, setCustomTo] = useState(todayISO)
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all')
  const [filterBrand, setFilterBrand] = useState<string>('all')
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all')
  const [page, setPage] = useState(1)
  const [lowStockOpen, setLowStockOpen] = useState(false)
  const [missedOpen, setMissedOpen] = useState(false)
  const [abcOpen, setAbcOpen] = useState(true)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [discountData, setDiscountData] = useState<{
    saleCount?: number
    cashierStats: Array<{ cashierId: string; name: string; count: number; discountTotal: number; revenue: number; avgDiscountPct: number }>
    discountedLines: Array<{ saleId: string; createdAt: string; cashierName: string; productName: string; lineDiscount: number }>
  } | null>(null)
  const [posLookupMode, setPosLookupMode] = useState<PosLookupMode>('catalog')
  const [saleRecords, setSaleRecords] = useState<Sale[]>([])
  const [receiptsOpen, setReceiptsOpen] = useState(false)
  const [receiptSearch, setReceiptSearch] = useState('')
  const [receiptPage, setReceiptPage] = useState(1)
  const myBranchId = getMyBranchId()
  const PAGE_SIZE = 25
  const RECEIPTS_PAGE_SIZE = 15
  const LOW_STOCK_PREVIEW = 10

  async function refreshLocal() {
    const [txs, prods, cats, incs, sls] = await Promise.all([getTransactions(), getProducts(), getCategories(), getIncidents(), getSales()])
    setTransactions(txs)
    setProducts(prods)
    setCategories(cats)
    setIncidents(incs)
    setSaleRecords(sls)
    setLoading(false)
  }

  useEffect(() => {
    async function load() {
      const [txs, prods, cats, incs, sls] = await Promise.all([getTransactions(), getProducts(), getCategories(), getIncidents(), getSales()])
      if (prods.length > 0) {
        setTransactions(txs)
        setProducts(prods)
        setCategories(cats)
        setIncidents(incs)
        setSaleRecords(sls)
        setLoading(false)
      } else {
        await seedIfEmpty()
        await refreshLocal()
      }
      const synced = await syncFromServer()
      if (synced) await refreshLocal()
    }
    load()
    fetchSettings().then((s) => setPosLookupMode(s.posLookupMode)).catch(() => {})
    fetchMe().then((u) => {
      if (u && canViewReports(u)) {
        const fromIso = customFrom
        const toIso = customTo
        const qs = new URLSearchParams()
        if (fromIso) qs.set('from', fromIso)
        if (toIso) qs.set('to', toIso)
        if (myBranchId && u.role === 'MANAGER') qs.set('branchId', myBranchId)
        fetch(`/api/reports/discounts?${qs}`, { cache: 'no-store' })
          .then((r) => r.json())
          .then(({ data }) => { if (data) setDiscountData(data) })
          .catch(() => {})
      }
    })
  }, [])

  const includeBarcodeSearch = barcodeSearchEnabled(posLookupMode)

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
    return counts
  }, [products])
  const brands = useMemo(() => getBrandOptions(products), [products])
  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const product of products) {
      const brand = getProductBrand(product)
      counts[brand] = (counts[brand] ?? 0) + 1
    }
    return counts
  }, [products])
  const stockByProductId = useMemo(
    () => buildStockByProductId(products, transactions, myBranchId ?? undefined),
    [products, transactions, myBranchId],
  )

  // Scope all transaction lookups to this branch (pre-migration txs without branchId count for all)
  const branchTransactions = useMemo(
    () => myBranchId
      ? transactions.filter((tx) => !tx.branchId || tx.branchId === myBranchId)
      : transactions,
    [transactions, myBranchId],
  )

  // Most recent SALE date per product (across ALL time, for "days since last sale")
  const lastSaleDate = useMemo(() => {
    const map: Record<string, Date> = {}
    for (const tx of branchTransactions) {
      if (tx.type !== 'SALE') continue
      const d = new Date(tx.createdAt)
      if (!map[tx.productId] || d > map[tx.productId]) map[tx.productId] = d
    }
    return map
  }, [branchTransactions])

  const { start, end } = getRangeBounds(range, customFrom, customTo)
  const rangeLabel = getRangeLabel(range, customFrom, customTo)
  const filtered = branchTransactions.filter((tx) => inRange(tx.createdAt, start, end))
  const customRangeInvalid = range === 'custom' && customFrom && customTo && customFrom > customTo

  const sales     = filtered.filter((t) => t.type === 'SALE')
  const stockIns  = filtered.filter((t) => t.type === 'STOCK_IN')

  // Quantities/money are Decimal in the DB; summing as JS floats drifts
  // (e.g. 21 → 21.0000001 → renders as "21.001"). Round to 2dp so genuine
  // fractional units survive but sub-unit noise doesn't reach the UI.
  const round2 = (n: number) => Math.round(n * 100) / 100

  const revenue     = round2(sales.reduce((sum, t) => sum + (t.unitPrice ?? productMap[t.productId]?.sellingPrice ?? 0) * t.quantity, 0))
  const listRevenue = round2(sales.reduce((sum, t) => sum + (productMap[t.productId]?.sellingPrice ?? 0) * t.quantity, 0))
  const unitsSold    = round2(sales.reduce((sum, t) => sum + t.quantity, 0))
  const unitsStocked = round2(stockIns.reduce((sum, t) => sum + t.quantity, 0))

  const activityProductIds = Array.from(
    new Set([...sales.map((t) => t.productId), ...stockIns.map((t) => t.productId)]),
  )

  const allRows: ReportRow[] = activityProductIds.map((id) => {
    const p = productMap[id]
    const pSales   = sales.filter((t) => t.productId === id)
    const sold     = round2(pSales.reduce((s, t) => s + t.quantity, 0))
    const stocked  = round2(stockIns.filter((t) => t.productId === id).reduce((s, t) => s + t.quantity, 0))
    const listRev  = round2(sold * (p?.sellingPrice ?? 0))
    const actRev   = round2(pSales.reduce((s, t) => s + (t.unitPrice ?? p?.sellingPrice ?? 0) * t.quantity, 0))
    return {
      productId:     id,
      name:          p?.name ?? id,
      sku:           p?.sku  ?? '—',
      specification: p?.specification,
      stockUnit:     p?.stockUnit,
      category:      p ? (categoryMap[p.categoryId] ?? '—') : '—',
      sold,
      stocked,
      listRevenue:   listRev,
      revenue:       actRev,
      netStock:      round2(stockByProductId[id] ?? (p?.initialStock ?? 0)),
      isStockOnly:   stocked > 0 && sold === 0,
    }
  })
    .filter((r) => r.sold > 0 || r.stocked > 0)
    .sort((a, b) => {
      if (a.isStockOnly !== b.isStockOnly) return a.isStockOnly ? 1 : -1
      return (b.revenue || b.stocked) - (a.revenue || a.stocked)
    })

  const soldRowCount    = allRows.filter((r) => r.sold > 0).length
  const stockedRowCount = allRows.filter((r) => r.isStockOnly).length

  // ── ABC Analysis ────────────────────────────────────────────────────────────
  // A = top 70% of revenue (fast movers)
  // B = next 20%, cumulative 70–90% (medium movers)
  // C = bottom 10% + zero-sales products (slow movers)
  const abcAnalysis = useMemo(() => {
    const totalRev = allRows.reduce((s, r) => s + r.revenue, 0)

    // Only products with actual sales in the selected range participate in ranking
    const withSales = [...allRows]
      .filter((r) => r.sold > 0)
      .sort((a, b) => b.revenue - a.revenue)

    type ABCRow = ReportRow & { abcClass: 'A' | 'B' | 'C'; revenueShare: number }
    let cumulative = 0
    const classified: ABCRow[] = withSales.map((row) => {
      cumulative += row.revenue
      const pct = totalRev > 0 ? cumulative / totalRev : 1
      return {
        ...row,
        abcClass:     pct <= 0.7 ? 'A' : pct <= 0.9 ? 'B' : 'C',
        revenueShare: totalRev > 0 ? row.revenue / totalRev : 0,
      }
    })

    const aItems = classified.filter((r) => r.abcClass === 'A')
    const bItems = classified.filter((r) => r.abcClass === 'B')
    const cItems = classified.filter((r) => r.abcClass === 'C')

    // Zero-sales products in the range are always C
    const activePids = new Set(allRows.filter((r) => r.sold > 0).map((r) => r.productId))
    const zeroSaleProducts: ABCRow[] = products
      .filter((p) => !activePids.has(p.id))
      .map((p) => ({
        productId:     p.id,
        name:          p.name,
        sku:           p.sku,
        specification: p.specification,
        stockUnit:     p.stockUnit,
        category:      categoryMap[p.categoryId] ?? '—',
        sold:          0,
        stocked:       0,
        listRevenue:   0,
        revenue:       0,
        netStock:      stockByProductId[p.id] ?? (p.initialStock ?? 0),
        isStockOnly:   false,
        abcClass:      'C' as const,
        revenueShare:  0,
      }))

    const aRevShare = totalRev > 0 ? aItems.reduce((s, r) => s + r.revenue, 0) / totalRev : 0
    const bRevShare = totalRev > 0 ? bItems.reduce((s, r) => s + r.revenue, 0) / totalRev : 0
    const cRevShare = totalRev > 0 ? cItems.reduce((s, r) => s + r.revenue, 0) / totalRev : 0

    return { aItems, bItems, cItems, zeroSaleProducts, aRevShare, bRevShare, cRevShare, totalRev }
  }, [allRows, products, categoryMap, stockByProductId])

  function daysSince(productId: string): string {
    const last = lastSaleDate[productId]
    if (!last) return 'Never sold'
    const days = Math.floor((Date.now() - last.getTime()) / 86_400_000)
    if (days === 0) return 'Today'
    if (days === 1) return '1 day ago'
    return `${days} days ago`
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Apply search + category filter
  const nq = normalizeQuery(search.trim())
  const rows = allRows.filter((r) => {
    if (activityFilter === 'sold' && r.sold === 0) return false
    if (activityFilter === 'stocked' && !r.isStockOnly) return false
    const p = productMap[r.productId]
    if (filterCategoryId !== 'all' && p?.categoryId !== filterCategoryId) return false
    if (filterBrand !== 'all' && p && getProductBrand(p) !== filterBrand) return false
    if (!p) return !nq
    return matchesProductSearch(p, nq, categoryMap[p.categoryId] ?? '', {
      includeBarcode: includeBarcodeSearch,
    })
  })

  function setActivityFilterAndReset(f: ActivityFilter) {
    setActivityFilter(f)
    setPage(1)
  }

  function setRangeAndReset(r: Range) {
    setRange(r)
    setPage(1)
    if (r === 'custom' && !customFrom) {
      setCustomFrom(monthStartISO())
      setCustomTo(todayISO())
    }
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const paginatedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const lowStockItems = getLowStockItems(products, transactions, stockByProductId)
  const lowStockCount = lowStockItems.length
  const discountGiven = listRevenue - revenue
  const hasDiscount = discountGiven > 0
  const showBothPrices = allRows.some((r) => r.listRevenue !== r.revenue)

  // Incidents for range
  const incidentsInRange = incidents.filter((i) => inRange(i.createdAt, start, end))
  const incidentMap = new Map<string, { productName: string; count: number; reasons: Record<string, number> }>()
  for (const inc of incidentsInRange) {
    const key = inc.productId ?? `__free__${inc.productName}`
    if (!incidentMap.has(key)) {
      incidentMap.set(key, { productName: inc.productName, count: 0, reasons: {} })
    }
    const s = incidentMap.get(key)!
    s.count++
    s.reasons[inc.reason] = (s.reasons[inc.reason] ?? 0) + 1
  }
  const heatspots = [...incidentMap.values()].sort((a, b) => b.count - a.count)

  // ── Receipts ────────────────────────────────────────────────────────────────
  // Reconstruct past sales so any receipt can be reprinted. SALE lines are
  // grouped by saleId (covering sales synced from every device); the local sales
  // store — when it holds the record this device rang up — supplies the
  // authoritative total (which reflects any whole-cart discount the lines alone
  // don't capture). A void reverses stock with a RETURN that sync remaps to a
  // STOCK_IN (see lib/db/seed.ts); since only those reversals carry a saleId, a
  // STOCK_IN tied to a saleId marks that sale as voided.
  const saleRecordMap = new Map(saleRecords.map((s) => [s.id, s]))
  const voidedSaleIds = new Set<string>()
  for (const tx of branchTransactions) {
    if (tx.type === 'STOCK_IN' && tx.saleId) voidedSaleIds.add(tx.saleId)
  }

  type ReceiptLine = { name: string; sku?: string; qty: number; unitPrice: number }
  const receiptGroups = new Map<string, { id: string; createdAt: string; lines: ReceiptLine[] }>()
  for (const tx of filtered) {
    if (tx.type !== 'SALE') continue
    const sid = tx.saleId ?? tx.orderId
    if (!sid) continue
    const g = receiptGroups.get(sid) ?? { id: sid, createdAt: tx.createdAt, lines: [] }
    if (tx.createdAt < g.createdAt) g.createdAt = tx.createdAt
    const p = productMap[tx.productId]
    g.lines.push({
      name: p?.name ?? tx.productId,
      sku: p?.sku,
      qty: tx.quantity,
      unitPrice: tx.unitPrice ?? p?.sellingPrice ?? 0,
    })
    receiptGroups.set(sid, g)
  }

  const rq = normalizeQuery(receiptSearch.trim())
  const allReceipts = [...receiptGroups.values()]
    .map((g) => {
      const rec = saleRecordMap.get(g.id)
      const lineTotal = round2(g.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0))
      return {
        id: g.id,
        createdAt: g.createdAt,
        lines: g.lines,
        itemCount: round2(g.lines.reduce((s, l) => s + l.qty, 0)),
        total: rec ? rec.total : lineTotal,
        voided: voidedSaleIds.has(g.id),
      }
    })
    .filter((r) => {
      if (!rq) return true
      if (r.id.toLowerCase().includes(rq)) return true
      return r.lines.some((l) => normalizeQuery(l.name).includes(rq) || (l.sku ? normalizeQuery(l.sku).includes(rq) : false))
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const receiptPageCount = Math.max(1, Math.ceil(allReceipts.length / RECEIPTS_PAGE_SIZE))
  const paginatedReceipts = allReceipts.slice((receiptPage - 1) * RECEIPTS_PAGE_SIZE, receiptPage * RECEIPTS_PAGE_SIZE)

  async function reprintReceipt(
    r: { id: string; createdAt: string; total: number; lines: ReceiptLine[] },
    mode: 'print' | 'save',
  ) {
    try {
      const { generateReceiptPDF, printPDF } = await import('@/lib/pdf')
      const doc = generateReceiptPDF({
        orderId: r.id,
        total: r.total,
        date: new Date(r.createdAt).toLocaleString('en-KE', {
          year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }),
        items: r.lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty, unitPrice: l.unitPrice })),
      })
      if (mode === 'print') printPDF(doc)
      else doc.save(`receipt-${r.id.slice(0, 8)}.pdf`)
    } catch {
      toast.error('Failed to generate receipt')
    }
  }

  function exportCsv() {
    const header = 'Type,Product,SKU,Category,Sold,Stocked,List Revenue,Actual Revenue,Discount,Net Stock'
    const lines = rows.map((r) =>
      `"${r.isStockOnly ? 'Stocked in' : 'Sold'}","${r.name}","${r.sku}","${r.category}",${r.sold},${r.stocked},${r.listRevenue.toFixed(2)},${r.revenue.toFixed(2)},${(r.listRevenue - r.revenue).toFixed(2)},${r.netStock}`
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `pos-report-${range === 'custom' ? `${customFrom}_to_${customTo}` : range}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPDF() {
    try {
      const { generateCOBReportPDF } = await import('@/lib/pdf')

      // ── Stock movement (ABC) — same classification as the on-screen view
      const aRev = abcAnalysis.aItems.reduce((s, r) => s + r.revenue, 0)
      const bRev = abcAnalysis.bItems.reduce((s, r) => s + r.revenue, 0)
      const cRev = abcAnalysis.cItems.reduce((s, r) => s + r.revenue, 0)
      const slowPool = [...abcAnalysis.cItems, ...abcAnalysis.zeroSaleProducts]
      const abc = {
        summary: [
          { className: 'A' as const, label: 'Fast movers',   products: abcAnalysis.aItems.length, revenue: aRev, revenueShare: abcAnalysis.aRevShare },
          { className: 'B' as const, label: 'Medium movers', products: abcAnalysis.bItems.length, revenue: bRev, revenueShare: abcAnalysis.bRevShare },
          { className: 'C' as const, label: 'Slow movers',   products: abcAnalysis.cItems.length + abcAnalysis.zeroSaleProducts.length, revenue: cRev, revenueShare: abcAnalysis.cRevShare },
        ],
        slowMovers: slowPool.slice(0, 25).map((r) => ({
          name: r.name,
          sku: r.sku,
          sold: r.sold,
          revenue: r.revenue,
          lastSale: daysSince(r.productId),
        })),
        slowMoverTotal: slowPool.length,
      }

      const doc = generateCOBReportPDF({
        dateLabel: rangeLabel,
        revenue,
        listRevenue,
        unitsSold,
        lowStockCount,
        rows,
        abc,
        lowStockItems: lowStockItems.map(({ product, stock }) => ({
          name: product.name,
          sku: product.sku,
          stock,
        })),
        missedSales: heatspots.map((h) => ({
          productName: h.productName,
          count: h.count,
          reasons: Object.entries(h.reasons)
            .map(([r, c]) => `${INCIDENT_REASON_LABELS[r as keyof typeof INCIDENT_REASON_LABELS] ?? r} (${c})`)
            .join(', '),
        })),
      })
      doc.save(`cob-report-${range === 'custom' ? `${customFrom}_to_${customTo}` : range}.pdf`)
      toast.success('Report downloaded as PDF')
    } catch {
      toast.error('Failed to generate PDF')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 border border-gray-300 px-3 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <Download size={14} />
              CSV
            </button>
            <button
              onClick={exportPDF}
              disabled={allRows.length === 0}
              className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              <FileText size={14} />
              Export PDF
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          <div className="flex flex-wrap gap-1 p-1.5 bg-gray-50 border-b border-gray-100">
            {RANGES.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => setRangeAndReset(value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  range === value
                    ? 'bg-white text-blue-700 shadow-sm ring-1 ring-gray-200'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-600 shrink-0">
                <CalendarRange size={16} className="text-blue-600" />
                <span className="font-medium text-gray-700">Select range</span>
              </div>

              <div className="inline-flex flex-col sm:flex-row items-stretch sm:items-center rounded-lg border border-gray-200 bg-gray-50 divide-y sm:divide-y-0 sm:divide-x divide-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-white sm:bg-transparent">
                  <label htmlFor="report-from" className="text-xs font-semibold text-gray-500 w-10 shrink-0">From</label>
                  <input
                    id="report-from"
                    type="date"
                    value={customFrom}
                    max={customTo || todayISO()}
                    onChange={(e) => { setCustomFrom(e.target.value); setPage(1) }}
                    className="text-sm text-gray-900 bg-transparent border-0 p-0 focus:outline-none focus:ring-0 min-w-[8.5rem]"
                  />
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-white sm:bg-transparent">
                  <label htmlFor="report-to" className="text-xs font-semibold text-gray-500 w-10 shrink-0">To</label>
                  <input
                    id="report-to"
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={todayISO()}
                    onChange={(e) => { setCustomTo(e.target.value); setPage(1) }}
                    className="text-sm text-gray-900 bg-transparent border-0 p-0 focus:outline-none focus:ring-0 min-w-[8.5rem]"
                  />
                </div>
              </div>

              <div className={`text-xs font-medium px-3 py-1.5 rounded-full shrink-0 self-start sm:self-center ${
                customRangeInvalid
                  ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                  : 'bg-blue-50 text-blue-800 ring-1 ring-blue-100'
              }`}>
                {customRangeInvalid
                  ? 'Dates swapped — end was before start'
                  : rangeLabel}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg shrink-0">
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Revenue</p>
            <p className="text-2xl font-bold mt-0.5">KSh {revenue.toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-0.5">Actual collected</p>
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-indigo-100 text-indigo-600 p-2.5 rounded-lg shrink-0">
            <BarChart3 size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Items sold</p>
            <p className="text-2xl font-bold mt-0.5">{unitsSold.toLocaleString()} <span className="text-base font-semibold text-gray-500">units</span></p>
            <p className="text-xs text-gray-500 mt-0.5">
              KSh {listRevenue.toLocaleString()} at list price
              {soldRowCount > 0 && ` · ${soldRowCount} product${soldRowCount === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className={`p-2.5 rounded-lg shrink-0 ${hasDiscount ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
            <Percent size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Discount given</p>
            <p className={`text-2xl font-bold mt-0.5 ${hasDiscount ? 'text-amber-600' : ''}`}>
              {hasDiscount ? `KSh ${discountGiven.toLocaleString()}` : '—'}
            </p>
            {hasDiscount && listRevenue > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                {Math.round((discountGiven / listRevenue) * 100)}% off list revenue
              </p>
            )}
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className={`p-2.5 rounded-lg shrink-0 ${unitsStocked > 0 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
            <ArrowDownToLine size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Stock-in</p>
            <p className={`text-2xl font-bold mt-0.5 ${unitsStocked > 0 ? 'text-green-700' : ''}`}>
              {unitsStocked > 0 ? unitsStocked.toLocaleString() : '—'}
              {unitsStocked > 0 && <span className="text-base font-semibold text-green-600/80"> units</span>}
            </p>
            {stockedRowCount > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                {stockedRowCount} product{stockedRowCount === 1 ? '' : 's'} restocked
              </p>
            )}
          </div>
        </div>
        <Link
          href="/products?stock=low"
          className={`border border-gray-200 rounded-xl p-5 flex items-start gap-4 transition-colors hover:bg-gray-50 ${lowStockCount > 0 ? 'ring-1 ring-amber-200' : ''}`}
        >
          <div className={`p-2.5 rounded-lg shrink-0 ${lowStockCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
            <Package size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Low stock items</p>
            <p className={`text-2xl font-bold mt-0.5 ${lowStockCount > 0 ? 'text-amber-600' : ''}`}>{lowStockCount}</p>
            {lowStockCount > 0 && <p className="text-xs text-blue-600 mt-0.5">Restock →</p>}
          </div>
        </Link>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-orange-100 text-orange-600 p-2.5 rounded-lg shrink-0">
            <FileText size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Missed sales</p>
            <p className="text-2xl font-bold mt-0.5 text-orange-600">{heatspots.reduce((s, h) => s + h.count, 0)}</p>
          </div>
        </div>
      </div>

      {/* Low stock — collapsed by default */}
      {lowStockCount > 0 && (
        <div className="mb-4 border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setLowStockOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-amber-100/50 transition-colors"
          >
            <ChevronDown size={16} className={`text-amber-700 shrink-0 transition-transform ${lowStockOpen ? 'rotate-180' : ''}`} />
            <span className="text-sm font-medium text-amber-900 flex-1">
              {lowStockCount} item{lowStockCount !== 1 ? 's' : ''} below {LOW_STOCK_THRESHOLD} units
            </span>
            <Link
              href="/products?stock=low"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:underline shrink-0"
            >
              Restock →
            </Link>
          </button>
          {lowStockOpen && (
            <div className="border-t border-amber-200 bg-white px-4 py-3">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-gray-100">
                  {lowStockItems.slice(0, LOW_STOCK_PREVIEW).map(({ product, stock }) => (
                    <tr key={product.id}>
                      <td className="py-1.5 font-medium text-gray-800">{product.name}</td>
                      <td className="py-1.5 text-gray-400 font-mono">{product.sku}</td>
                      <td className="py-1.5 text-right text-amber-700 font-semibold">{stock} left</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lowStockCount > LOW_STOCK_PREVIEW && (
                <p className="text-xs text-gray-500 mt-2">
                  + {lowStockCount - LOW_STOCK_PREVIEW} more in{' '}
                  <Link href="/products?stock=low" className="text-blue-600 hover:underline">Products</Link>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Missed sales — collapsed by default */}
      {heatspots.length > 0 && (
        <div className="mb-4 border border-orange-200 bg-orange-50 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setMissedOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-orange-100/50 transition-colors"
          >
            <ChevronDown size={16} className={`text-orange-700 shrink-0 transition-transform ${missedOpen ? 'rotate-180' : ''}`} />
            <span className="text-sm font-medium text-orange-900">
              {heatspots.reduce((s, h) => s + h.count, 0)} missed sale{heatspots.reduce((s, h) => s + h.count, 0) !== 1 ? 's' : ''} · {heatspots.length} product{heatspots.length !== 1 ? 's' : ''}
            </span>
          </button>
          {missedOpen && (
            <div className="border-t border-orange-200 bg-white px-4 py-3 space-y-2">
              {heatspots.slice(0, 8).map((h) => (
                <div key={h.productName} className="flex items-start gap-3">
                  <span className="text-xs font-bold text-orange-700 bg-orange-100 rounded-full px-2 py-0.5 shrink-0">{h.count}×</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{h.productName}</p>
                    <p className="text-xs text-gray-500">
                      {Object.entries(h.reasons)
                        .map(([r, c]) => `${INCIDENT_REASON_LABELS[r as keyof typeof INCIDENT_REASON_LABELS] ?? r}${c > 1 ? ` (${c})` : ''}`)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              ))}
              {heatspots.length > 8 && (
                <p className="text-xs text-gray-500">+ {heatspots.length - 8} more products</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Discount accountability */}
      {discountData && discountData.cashierStats.length > 0 && (
        <div className="mb-4 border border-amber-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setDiscountOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left bg-amber-50 hover:bg-amber-100/50 transition-colors"
          >
            <ChevronDown size={16} className={`text-amber-700 shrink-0 transition-transform ${discountOpen ? 'rotate-180' : ''}`} />
            <span className="text-sm font-medium text-amber-900 flex-1">Discounts by cashier</span>
            <span className="text-xs text-amber-700">{discountData.saleCount ?? discountData.cashierStats.reduce((s, c) => s + c.count, 0)} sales</span>
          </button>
          {discountOpen && (
            <div className="border-t border-amber-200 bg-white px-4 py-3 space-y-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 uppercase">
                    <th className="text-left py-1">Cashier</th>
                    <th className="text-right py-1">Sales</th>
                    <th className="text-right py-1">Discount (KES)</th>
                    <th className="text-right py-1">Avg %</th>
                    <th className="text-right py-1">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {discountData.cashierStats.map((c) => (
                    <tr key={c.cashierId}>
                      <td className="py-1.5 font-medium">{c.name}</td>
                      <td className="py-1.5 text-right">{c.count}</td>
                      <td className="py-1.5 text-right text-amber-600">{Math.round(c.discountTotal).toLocaleString()}</td>
                      <td className="py-1.5 text-right">{c.avgDiscountPct}%</td>
                      <td className="py-1.5 text-right">{Math.round(c.revenue).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {discountData.discountedLines.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Below-list sales</p>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {discountData.discountedLines.slice(0, 20).map((line, i) => (
                      <div key={`${line.saleId}-${i}`} className="flex justify-between text-xs gap-2">
                        <span className="truncate">{line.productName} · {line.cashierName}</span>
                        <span className="text-amber-600 shrink-0">−{Math.round(line.lineDiscount).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Receipts — look up & reprint a past sale */}
      {(allReceipts.length > 0 || receiptSearch) && (
        <div className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setReceiptsOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronDown size={16} className={`text-gray-500 shrink-0 transition-transform ${receiptsOpen ? 'rotate-180' : ''}`} />
            <Receipt size={15} className="text-blue-600 shrink-0" />
            <span className="text-sm font-semibold text-gray-800 flex-1">Receipts</span>
            <span className="text-xs text-gray-400 shrink-0">
              {allReceipts.length} sale{allReceipts.length === 1 ? '' : 's'} · {rangeLabel}
            </span>
          </button>

          {receiptsOpen && (
            <div className="border-t border-gray-100">
              <div className="p-3 border-b border-gray-100 bg-gray-50">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={receiptSearch}
                    onChange={(e) => { setReceiptSearch(e.target.value); setReceiptPage(1) }}
                    placeholder="Search by order number or product…"
                    className="w-full border border-gray-200 rounded-lg pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  {receiptSearch && (
                    <button onClick={() => { setReceiptSearch(''); setReceiptPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              {paginatedReceipts.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No receipts match your search.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {paginatedReceipts.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-800">
                            {new Date(r.createdAt).toLocaleString('en-KE', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                          {r.voided && (
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Voided</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono truncate">#{r.id.slice(0, 8)} · {r.itemCount} item{r.itemCount === 1 ? '' : 's'}</p>
                      </div>
                      <p className="text-sm font-semibold text-gray-700 shrink-0 tabular-nums">KSh {r.total.toLocaleString()}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => reprintReceipt(r, 'print')} title="Print receipt" className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100">
                          <Printer size={15} />
                        </button>
                        <button onClick={() => reprintReceipt(r, 'save')} title="Download PDF" className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100">
                          <Download size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {receiptPageCount > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500">
                    Showing {(receiptPage - 1) * RECEIPTS_PAGE_SIZE + 1}–{Math.min(receiptPage * RECEIPTS_PAGE_SIZE, allReceipts.length)} of {allReceipts.length}
                  </p>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setReceiptPage((p) => p - 1)} disabled={receiptPage === 1} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      <ChevronLeft size={15} />
                    </button>
                    <span className="text-xs text-gray-500 px-2 tabular-nums">{receiptPage} / {receiptPageCount}</span>
                    <button onClick={() => setReceiptPage((p) => p + 1)} disabled={receiptPage === receiptPageCount} className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ABC Movement Analysis */}
      {!loading && allRows.some((r) => r.sold > 0) && (
        <div className="mb-4 border border-gray-200 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setAbcOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 text-left bg-white hover:bg-gray-50 transition-colors"
          >
            <ChevronDown size={16} className={`text-gray-500 shrink-0 transition-transform ${abcOpen ? 'rotate-180' : ''}`} />
            <span className="text-sm font-semibold text-gray-800 flex-1">Stock movement analysis</span>
            <span className="text-xs text-gray-400 shrink-0">ABC · {rangeLabel}</span>
          </button>

          {abcOpen && (
            <div className="border-t border-gray-100">
              {/* Legend */}
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-4 text-xs text-gray-500">
                <span><span className="font-bold text-green-700">A</span> = top 70% of revenue · fast movers</span>
                <span><span className="font-bold text-blue-700">B</span> = next 20% · medium movers</span>
                <span><span className="font-bold text-amber-700">C</span> = bottom 10% + zero sales · slow movers</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">

                {/* ── A: Fast movers ── */}
                <ABCColumn
                  label="Fast movers"
                  badge="A"
                  badgeClass="bg-green-100 text-green-800"
                  headerClass="bg-green-50"
                  count={abcAnalysis.aItems.length}
                  revenueShare={abcAnalysis.aRevShare}
                  totalRev={abcAnalysis.totalRev}
                  items={abcAnalysis.aItems.slice(0, 10)}
                  showDaysSince={false}
                  daysSince={daysSince}
                  categoryMap={categoryMap}
                />

                {/* ── B: Medium movers ── */}
                <ABCColumn
                  label="Medium movers"
                  badge="B"
                  badgeClass="bg-blue-100 text-blue-800"
                  headerClass="bg-blue-50"
                  count={abcAnalysis.bItems.length}
                  revenueShare={abcAnalysis.bRevShare}
                  totalRev={abcAnalysis.totalRev}
                  items={abcAnalysis.bItems.slice(0, 10)}
                  showDaysSince={false}
                  daysSince={daysSince}
                  categoryMap={categoryMap}
                />

                {/* ── C: Slow movers ── */}
                <ABCColumn
                  label="Slow movers"
                  badge="C"
                  badgeClass="bg-amber-100 text-amber-800"
                  headerClass="bg-amber-50"
                  count={abcAnalysis.cItems.length + abcAnalysis.zeroSaleProducts.length}
                  revenueShare={abcAnalysis.cRevShare}
                  totalRev={abcAnalysis.totalRev}
                  items={[...abcAnalysis.cItems, ...abcAnalysis.zeroSaleProducts].slice(0, 15)}
                  showDaysSince={true}
                  daysSince={daysSince}
                  categoryMap={categoryMap}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex flex-wrap gap-1">
          {([
            { value: 'all' as const,     label: 'All activity' },
            { value: 'sold' as const,    label: `Sold${soldRowCount > 0 ? ` (${soldRowCount})` : ''}` },
            { value: 'stocked' as const, label: `Stocked in${stockedRowCount > 0 ? ` (${stockedRowCount})` : ''}` },
          ]).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setActivityFilterAndReset(value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activityFilter === value
                  ? value === 'stocked'
                    ? 'bg-green-600 text-white'
                    : value === 'sold'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch mb-2">
        <div className="relative flex-1 min-w-0 w-full">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name, SKU, brand, category or size…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
          />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
        {(categories.length > 0 || brands.length > 0) && (
          <div className={`grid gap-2 min-w-0 sm:flex sm:shrink-0 ${categories.length > 0 && brands.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {categories.length > 0 && (
              <CategoryPicker
                categories={categories}
                counts={categoryCounts}
                value={filterCategoryId}
                onChange={(id) => { setFilterCategoryId(id); setPage(1) }}
              />
            )}
            {brands.length > 0 && (
              <BrandPicker
                brands={brands}
                counts={brandCounts}
                value={filterBrand}
                onChange={(brand) => { setFilterBrand(brand); setPage(1) }}
              />
            )}
          </div>
        )}
      </div>

      {!loading && (
        <p className="text-xs text-gray-500 mb-4">
          {rows.length.toLocaleString()} product{rows.length === 1 ? '' : 's'}
          {activityFilter === 'sold' ? ' sold' : activityFilter === 'stocked' ? ' stocked in' : ''}
          {filterBrand !== 'all' ? ` · ${filterBrand}` : ''}
          {' · '}{rangeLabel}
          {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ''}
        </p>
      )}

      {/* Breakdown table */}
      {loading ? (
        <div className="flex justify-center py-20 text-gray-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <p className="text-sm">
            {search
              ? `No results for "${search}"`
              : activityFilter === 'stocked'
                ? 'No stock received in this period'
                : activityFilter === 'sold'
                  ? 'No sales for this period'
                  : 'No sales or stock activity for this period'}
          </p>
          {search && <button onClick={() => setSearch('')} className="mt-2 text-xs text-blue-600 hover:underline">Clear search</button>}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Spec / Size</th>
                <th className="text-left px-4 py-3">SKU</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Sold</th>
                <th className="text-right px-4 py-3">Stocked</th>
                {showBothPrices && <th className="text-right px-4 py-3">List Rev (KSh)</th>}
                <th className="text-right px-4 py-3">{showBothPrices ? 'Actual Rev (KSh)' : 'Revenue (KSh)'}</th>
                <th className="text-right px-4 py-3">Net stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginatedRows.map((r) => (
                <tr
                  key={r.productId}
                  className={
                    r.isStockOnly
                      ? 'bg-green-50 hover:bg-green-100/70'
                      : 'bg-white hover:bg-gray-50'
                  }
                >
                  <td className="px-4 py-3 font-medium">
                    {r.name}
                    {r.isStockOnly && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                        Stock in
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.specification ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.sku}</td>
                  <td className="px-4 py-3 text-gray-500">{r.category}</td>
                  <td className="px-4 py-3 text-right">{r.sold > 0 ? `${r.sold}${r.stockUnit ? ` ${r.stockUnit}` : ''}` : '—'}</td>
                  <td className={`px-4 py-3 text-right ${r.stocked > 0 ? 'text-green-700 font-medium' : ''}`}>
                    {r.stocked > 0 ? `${r.stocked}${r.stockUnit ? ` ${r.stockUnit}` : ''}` : '—'}
                  </td>
                  {showBothPrices && (
                    <td className="px-4 py-3 text-right text-gray-400 line-through text-xs">
                      {r.sold > 0 ? r.listRevenue.toLocaleString() : '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-medium">
                    {r.sold > 0 ? (
                      <>
                        {r.revenue.toLocaleString()}
                        {showBothPrices && r.listRevenue > r.revenue && (
                          <span className="ml-1 text-xs text-amber-500">−{(r.listRevenue - r.revenue).toLocaleString()}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium ${r.netStock < LOW_STOCK_THRESHOLD ? 'text-amber-600' : 'text-gray-700'}`}>
                    {r.netStock}{r.stockUnit ? ` ${r.stockUnit}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs text-gray-500 px-2 tabular-nums">{page} / {pageCount}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === pageCount}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}

// ── ABCColumn ────────────────────────────────────────────────────────────────
interface ABCColumnProps {
  label: string
  badge: string
  badgeClass: string
  headerClass: string
  count: number
  revenueShare: number
  totalRev: number
  items: Array<{
    productId: string; name: string; sku: string
    sold: number; revenue: number; netStock: number; stockUnit?: string
  }>
  showDaysSince: boolean
  daysSince: (productId: string) => string
  categoryMap: Record<string, string>
}

function ABCColumn({
  label, badge, badgeClass, headerClass,
  count, revenueShare, totalRev,
  items, showDaysSince, daysSince,
}: ABCColumnProps) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, 5)

  return (
    <div className="flex flex-col">
      {/* Column header */}
      <div className={`px-4 py-3 ${headerClass} flex items-center gap-2`}>
        <span className={`text-sm font-bold px-2 py-0.5 rounded-md ${badgeClass}`}>{badge}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-800">{label}</p>
          <p className="text-xs text-gray-500">
            {count} product{count !== 1 ? 's' : ''}
            {revenueShare > 0 && (
              <> · <span className="font-medium">{Math.round(revenueShare * 100)}%</span> of revenue
                {' '}(KSh {Math.round(totalRev * revenueShare).toLocaleString()})
              </>
            )}
          </p>
        </div>
      </div>

      {/* Product rows */}
      <div className="flex-1 divide-y divide-gray-50">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs text-gray-400 italic">No products in this category for the selected period.</p>
        ) : (
          <>
            {visible.map((item) => (
              <div key={item.productId} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{item.name}</p>
                    <p className="text-[10px] text-gray-400 font-mono">{item.sku}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {item.sold > 0 ? (
                      <>
                        <p className="text-xs font-semibold text-gray-700">KSh {item.revenue.toLocaleString()}</p>
                        <p className="text-[10px] text-gray-400">{item.sold}{item.stockUnit ? ` ${item.stockUnit}` : ''} sold</p>
                      </>
                    ) : (
                      <p className="text-[10px] text-gray-400">No sales</p>
                    )}
                  </div>
                </div>
                {showDaysSince && (
                  <p className={`text-[10px] mt-0.5 font-medium ${
                    daysSince(item.productId) === 'Never sold'
                      ? 'text-red-500'
                      : daysSince(item.productId) === 'Today'
                        ? 'text-green-600'
                        : 'text-amber-600'
                  }`}>
                    Last sale: {daysSince(item.productId)}
                  </p>
                )}
              </div>
            ))}
            {items.length > 5 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="w-full px-4 py-2 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors text-left"
              >
                {expanded ? 'Show less' : `+ ${items.length - 5} more`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
