'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BarChart3, Package, ShoppingCart, TrendingUp } from 'lucide-react'
import { getAll as getTransactions } from '@/lib/db/transactions'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getIncidents } from '@/lib/db/incidents'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { buildStockByProductId, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import { getMyBranchId } from '@/lib/branch'
import type { InventoryTransaction, Product, Incident } from '@/lib/types'

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function last7Days(): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(dayKey(d))
  }
  return days
}

type Range = 'today' | 'week' | 'month'

function rangeStart(r: Range): Date {
  const d = new Date()
  if (r === 'today') { d.setHours(0, 0, 0, 0); return d }
  if (r === 'week')  { d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d }
  d.setDate(1); d.setHours(0, 0, 0, 0); return d
}

const RANGE_LABELS: Record<Range, string> = { today: 'Today', week: 'This week', month: 'This month' }

export default function DashboardPage() {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('today')

  useEffect(() => {
    async function load() {
      const [txs, prods, incs] = await Promise.all([getTransactions(), getProducts(), getIncidents()])
      if (prods.length > 0) {
        setTransactions(txs)
        setProducts(prods)
        setIncidents(incs)
        setLoading(false)
      } else {
        await seedIfEmpty()
        const [t, p, i] = await Promise.all([getTransactions(), getProducts(), getIncidents()])
        setTransactions(t)
        setProducts(p)
        setIncidents(i)
        setLoading(false)
      }
      const synced = await syncFromServer()
      if (synced) {
        const [t, p, i] = await Promise.all([getTransactions(), getProducts(), getIncidents()])
        setTransactions(t)
        setProducts(p)
        setIncidents(i)
      }
    }
    load()
  }, [])

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )
  const myBranchId = getMyBranchId() ?? undefined
  const stockByProductId = useMemo(
    () => buildStockByProductId(products, transactions, myBranchId),
    [products, transactions, myBranchId],
  )

  const start = rangeStart(range)
  const sales = transactions.filter((t) => t.type === 'SALE' && new Date(t.createdAt) >= start)
  const revenue = sales.reduce((s, t) => s + (t.unitPrice ?? productMap[t.productId]?.sellingPrice ?? 0) * t.quantity, 0)
  const listRevenue = sales.reduce((s, t) => s + (productMap[t.productId]?.sellingPrice ?? 0) * t.quantity, 0)
  const unitsSold = sales.reduce((s, t) => s + t.quantity, 0)
  const discountGiven = listRevenue - revenue

  const lowStockCount = products.filter((p) => {
    const stock = stockByProductId[p.id] ?? (p.initialStock ?? 0)
    return stock < LOW_STOCK_THRESHOLD
  }).length

  const missedCount = incidents.filter((i) => new Date(i.createdAt) >= start).length

  // Top products by revenue
  const topProductsMap = new Map<string, { name: string; revenue: number; qty: number }>()
  for (const t of sales) {
    const p = productMap[t.productId]
    if (!topProductsMap.has(t.productId)) {
      topProductsMap.set(t.productId, { name: p?.name ?? t.productId, revenue: 0, qty: 0 })
    }
    const s = topProductsMap.get(t.productId)!
    s.revenue += (t.unitPrice ?? p?.sellingPrice ?? 0) * t.quantity
    s.qty += t.quantity
  }
  const topProducts = [...topProductsMap.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5)

  // Last 7 days daily revenue trend
  const days = last7Days()
  const dailyRevenue: Record<string, number> = {}
  for (const day of days) dailyRevenue[day] = 0
  for (const t of transactions.filter((t) => t.type === 'SALE')) {
    const k = dayKey(new Date(t.createdAt))
    if (k in dailyRevenue) {
      dailyRevenue[k] += (t.unitPrice ?? productMap[t.productId]?.sellingPrice ?? 0) * t.quantity
    }
  }
  const maxDaily = Math.max(...Object.values(dailyRevenue), 1)

  // Recent sales
  const recentSales = transactions
    .filter((t) => t.type === 'SALE')
    .slice(0, 8)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Loading…</div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['today', 'week', 'month'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 transition-colors ${range === r ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-blue-100 text-blue-600 p-2 rounded-lg"><TrendingUp size={16} /></div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Revenue</p>
          </div>
          <p className="text-2xl font-bold">KSh {revenue.toLocaleString()}</p>
          {discountGiven > 0 && <p className="text-xs text-amber-600 mt-1">−KSh {discountGiven.toLocaleString()} discounts</p>}
        </div>

        <div className="border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-green-100 text-green-600 p-2 rounded-lg"><BarChart3 size={16} /></div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Units Sold</p>
          </div>
          <p className="text-2xl font-bold">{unitsSold.toLocaleString()}</p>
        </div>

        <div className="border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className={`p-2 rounded-lg ${lowStockCount > 0 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
              <Package size={16} />
            </div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Low Stock</p>
          </div>
          <p className={`text-2xl font-bold ${lowStockCount > 0 ? 'text-amber-600' : ''}`}>{lowStockCount}</p>
          {lowStockCount > 0 && (
            <Link href="/products?stock=low" className="text-xs text-blue-600 hover:underline mt-1 inline-block">Restock →</Link>
          )}
        </div>

        <div className="border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="bg-orange-100 text-orange-600 p-2 rounded-lg"><ShoppingCart size={16} /></div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Missed Sales</p>
          </div>
          <p className={`text-2xl font-bold ${missedCount > 0 ? 'text-orange-600' : ''}`}>{missedCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 7-day revenue trend */}
        <div className="border border-gray-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Revenue — last 7 days</p>
          <div className="flex items-end gap-1.5 h-28">
            {days.map((day) => {
              const val = dailyRevenue[day] ?? 0
              const height = Math.max(4, Math.round((val / maxDaily) * 100))
              const isToday = day === dayKey(new Date())
              return (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    title={`KSh ${val.toLocaleString()}`}
                    className={`w-full rounded-t transition-all ${isToday ? 'bg-blue-600' : 'bg-blue-200'}`}
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[10px] text-gray-400">{day.slice(8)}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top products */}
        <div className="border border-gray-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-gray-700 mb-4">Top products ({RANGE_LABELS[range].toLowerCase()})</p>
          {topProducts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center mt-8">No sales yet</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-gray-400">{p.qty} units</p>
                  </div>
                  <span className="text-sm font-semibold text-blue-600">KSh {p.revenue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent sales */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-700">Recent Sales</p>
        </div>
        {recentSales.length === 0 ? (
          <div className="text-sm text-gray-400 text-center py-12">No recent sales</div>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {recentSales.map((t) => {
                const p = productMap[t.productId]
                const price = t.unitPrice ?? p?.sellingPrice ?? 0
                const isDiscounted = p && t.unitPrice != null && t.unitPrice < p.sellingPrice
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium">{p?.name ?? t.productId}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">×{t.quantity}</td>
                    <td className="px-4 py-2.5 text-right">
                      KSh {(price * t.quantity).toLocaleString()}
                      {isDiscounted && <span className="ml-1 text-xs text-amber-500">disc</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                      {new Date(t.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
        {[
          { href: '/pos',       label: 'Go to POS',       color: 'bg-blue-600 hover:bg-blue-700' },
          { href: '/products',  label: 'Manage Products', color: 'bg-gray-700 hover:bg-gray-800' },
          { href: '/products?stock=low', label: 'Restock', color: 'bg-green-600 hover:bg-green-700' },
          { href: '/reports',   label: 'Reports',         color: 'bg-purple-600 hover:bg-purple-700' },
        ].map(({ href, label, color }) => (
          <Link
            key={href}
            href={href}
            className={`${color} text-white text-sm font-medium py-2.5 rounded-xl text-center transition-colors`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
    </div>
  )
}
