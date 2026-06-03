'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Package, TrendingUp, Download } from 'lucide-react'
import { getAll as getTransactions } from '@/lib/db/transactions'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { seedIfEmpty } from '@/lib/db/seed'
import type { InventoryTransaction, Product, ProductCategory } from '@/lib/types'

type Range = 'today' | 'week' | 'month' | 'all'

const RANGES: { label: string; value: Range }[] = [
  { label: 'Today',      value: 'today' },
  { label: 'This week',  value: 'week'  },
  { label: 'This month', value: 'month' },
  { label: 'All time',   value: 'all'   },
]

function rangeStart(range: Range): Date {
  const d = new Date()
  if (range === 'today') { d.setHours(0, 0, 0, 0); return d }
  if (range === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d }
  if (range === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); return d }
  return new Date(0)
}

interface ReportRow {
  productId: string
  name: string
  sku: string
  category: string
  sold: number
  stocked: number
  revenue: number
  netStock: number
}

const LOW_STOCK = 5

export default function ReportsPage() {
  const [range, setRange] = useState<Range>('today')
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      await seedIfEmpty()
      const [txs, prods, cats] = await Promise.all([getTransactions(), getProducts(), getCategories()])
      setTransactions(txs)
      setProducts(prods)
      setCategories(cats)
      setLoading(false)
    }
    load()
  }, [])

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  const start = rangeStart(range)
  const filtered = transactions.filter((tx) => new Date(tx.createdAt) >= start)

  const sales     = filtered.filter((t) => t.type === 'SALE')
  const stockIns  = filtered.filter((t) => t.type === 'STOCK_IN')

  const revenue   = sales.reduce((sum, t) => sum + (productMap[t.productId]?.sellingPrice ?? 0) * t.quantity, 0)
  const unitsSold = sales.reduce((sum, t) => sum + t.quantity, 0)

  // Per-product summary
  const allProductIds = Array.from(new Set(filtered.map((t) => t.productId)))
  const rows: ReportRow[] = allProductIds.map((id) => {
    const p = productMap[id]
    const sold    = sales.filter((t) => t.productId === id).reduce((s, t) => s + t.quantity, 0)
    const stocked = stockIns.filter((t) => t.productId === id).reduce((s, t) => s + t.quantity, 0)
    return {
      productId: id,
      name:      p?.name ?? id,
      sku:       p?.sku  ?? '—',
      category:  p ? (categoryMap[p.categoryId] ?? '—') : '—',
      sold,
      stocked,
      revenue:   sold * (p?.sellingPrice ?? 0),
      netStock:  stocked - sold,
    }
  }).sort((a, b) => b.revenue - a.revenue)

  // Low stock: products with net stock below threshold across ALL time
  const allTimeByProduct = new Map<string, number>()
  for (const tx of transactions) {
    const prev = allTimeByProduct.get(tx.productId) ?? 0
    allTimeByProduct.set(tx.productId, tx.type === 'STOCK_IN' ? prev + tx.quantity : prev - tx.quantity)
  }
  const lowStockCount = products.filter((p) => (allTimeByProduct.get(p.id) ?? 0) < LOW_STOCK).length

  function exportCsv() {
    const header = 'Product,SKU,Category,Sold,Stocked,Revenue,Net Stock'
    const lines = rows.map((r) =>
      `"${r.name}","${r.sku}","${r.category}",${r.sold},${r.stocked},${r.revenue.toFixed(2)},${r.netStock}`
    )
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `pos-report-${range}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {RANGES.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setRange(value)}
                className={`px-3 py-1.5 transition-colors ${
                  range === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 border border-gray-300 px-3 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-blue-100 text-blue-600 p-2.5 rounded-lg shrink-0">
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Revenue</p>
            <p className="text-2xl font-bold mt-0.5">KSh {revenue.toLocaleString()}</p>
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-green-100 text-green-600 p-2.5 rounded-lg shrink-0">
            <BarChart3 size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Units sold</p>
            <p className="text-2xl font-bold mt-0.5">{unitsSold.toLocaleString()}</p>
          </div>
        </div>
        <div className="border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="bg-amber-100 text-amber-600 p-2.5 rounded-lg shrink-0">
            <Package size={20} />
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Low stock items</p>
            <p className="text-2xl font-bold mt-0.5">{lowStockCount}</p>
          </div>
        </div>
      </div>

      {/* Breakdown table */}
      {loading ? (
        <div className="flex justify-center py-20 text-gray-400 text-sm">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <p className="text-sm">No transactions for this period</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">SKU</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-right px-4 py-3">Sold</th>
                <th className="text-right px-4 py-3">Stocked</th>
                <th className="text-right px-4 py-3">Revenue (KSh)</th>
                <th className="text-right px-4 py-3">Net stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.productId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.sku}</td>
                  <td className="px-4 py-3 text-gray-500">{r.category}</td>
                  <td className="px-4 py-3 text-right">{r.sold}</td>
                  <td className="px-4 py-3 text-right">{r.stocked}</td>
                  <td className="px-4 py-3 text-right font-medium">{r.revenue.toLocaleString()}</td>
                  <td className={`px-4 py-3 text-right font-medium ${r.netStock < LOW_STOCK ? 'text-amber-600' : 'text-gray-700'}`}>
                    {r.netStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  )
}
