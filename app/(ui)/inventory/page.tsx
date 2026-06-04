'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Select from '@radix-ui/react-select'
import * as Label from '@radix-ui/react-label'
import { AlertTriangle, ChevronDown, PackagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { create, getAll as getTransactions } from '@/lib/db/transactions'
import { push, drain } from '@/lib/db/syncQueue'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { computeStock, getLowStockItems, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import type { InventoryTransaction, Product, ProductCategory } from '@/lib/types'

const TYPE_LABELS: Record<string, string> = {
  SALE: 'Sale',
  STOCK_IN: 'Stock in',
  ADJUSTMENT: 'Adjustment',
}

const TYPE_COLORS: Record<string, string> = {
  SALE: 'bg-red-100 text-red-700',
  STOCK_IN: 'bg-green-100 text-green-700',
  ADJUSTMENT: 'bg-yellow-100 text-yellow-700',
}

export default function InventoryPage() {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [open, setOpen] = useState(false)
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState<string>('all')
  const [saving, setSaving] = useState(false)
  // per-item restock qty in the low-stock panel
  const [restockQtys, setRestockQtys] = useState<Record<string, string>>({})
  const [restocking, setRestocking] = useState<Record<string, boolean>>({})

  async function refreshLocal() {
    const [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
    setCategories(cats)
    setProducts(prods)
    setTransactions(txs)
  }

  useEffect(() => {
    async function load() {
      const [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      if (prods.length > 0) {
        setCategories(cats)
        setProducts(prods)
        setTransactions(txs)
      } else {
        await seedIfEmpty()
        await refreshLocal()
      }
      const synced = await syncFromServer()
      if (synced) await refreshLocal()
    }
    load()
  }, [])

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))
  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]))

  const visibleProducts = filterCategoryId === 'all'
    ? products
    : products.filter((p) => p.categoryId === filterCategoryId)

  const lowStockItems = getLowStockItems(products, transactions)

  const selectedProductStock = productId ? computeStock(productId, transactions) : null

  async function stockIn(pid: string, quantity: number): Promise<void> {
    const tx: InventoryTransaction = {
      id: crypto.randomUUID(),
      type: 'STOCK_IN',
      productId: pid,
      quantity,
      createdAt: new Date().toISOString(),
    }
    await create(tx)
    await push(tx)
    drain().catch(() => {})
    setTransactions((prev) => [tx, ...prev])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!productId || !qty) return
    setSaving(true)
    await stockIn(productId, parseInt(qty, 10))
    const name = productMap[productId]?.name ?? productId
    toast.success(`Stocked in — ${name}`, { description: `+${qty} units added` })
    setProductId('')
    setQty('')
    setOpen(false)
    setSaving(false)
  }

  async function handleQuickRestock(pid: string) {
    const q = parseInt(restockQtys[pid] ?? '', 10)
    if (!q || q < 1) {
      toast.error('Enter a valid quantity')
      return
    }
    setRestocking((r) => ({ ...r, [pid]: true }))
    await stockIn(pid, q)
    const name = productMap[pid]?.name ?? pid
    toast.success(`Restocked — ${name}`, { description: `+${q} units added` })
    setRestockQtys((r) => ({ ...r, [pid]: '' }))
    setRestocking((r) => ({ ...r, [pid]: false }))
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-3.5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
              <PackagePlus size={16} />
              Stock in
            </button>
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm z-50 focus:outline-none">
              <div className="flex items-center justify-between mb-5">
                <Dialog.Title className="text-lg font-semibold">Stock in</Dialog.Title>
                <Dialog.Close asChild>
                  <button className="text-gray-500 hover:text-gray-600 rounded-md p-1"><X size={18} /></button>
                </Dialog.Close>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label.Root className="text-sm font-medium text-gray-700">Category</Label.Root>
                  <Select.Root value={filterCategoryId} onValueChange={(v) => { setFilterCategoryId(v); setProductId('') }}>
                    <Select.Trigger className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <Select.Value placeholder="Filter by category" />
                      <Select.Icon><ChevronDown size={16} className="text-gray-500" /></Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="bg-white border border-gray-200 rounded-xl shadow-lg z-[60] overflow-hidden">
                        <Select.Viewport className="p-1">
                          <Select.Item value="all" className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                            <Select.ItemText>All categories</Select.ItemText>
                          </Select.Item>
                          {categories.map((c) => (
                            <Select.Item key={c.id} value={c.id} className="flex items-center px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                              <Select.ItemText>{c.name}</Select.ItemText>
                            </Select.Item>
                          ))}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                </div>

                <div className="space-y-1.5">
                  <Label.Root className="text-sm font-medium text-gray-700">Product</Label.Root>
                  <Select.Root value={productId} onValueChange={setProductId} required>
                    <Select.Trigger className="w-full flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <Select.Value placeholder="Select a product" />
                      <Select.Icon><ChevronDown size={16} className="text-gray-500" /></Select.Icon>
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Content className="bg-white border border-gray-200 rounded-xl shadow-lg z-[60] overflow-hidden">
                        <Select.Viewport className="p-1">
                          {visibleProducts.map((p) => {
                            const stock = computeStock(p.id, transactions)
                            return (
                              <Select.Item key={p.id} value={p.id} className="flex items-center justify-between px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                                <Select.ItemText>{p.name}</Select.ItemText>
                                {stock < LOW_STOCK_THRESHOLD && (
                                  <span className="ml-2 text-xs text-amber-600 font-medium shrink-0">{stock} left</span>
                                )}
                              </Select.Item>
                            )
                          })}
                        </Select.Viewport>
                      </Select.Content>
                    </Select.Portal>
                  </Select.Root>
                  {selectedProductStock !== null && (
                    <p className="text-xs text-gray-500">
                      Current stock:&nbsp;
                      <span className={selectedProductStock < LOW_STOCK_THRESHOLD ? 'text-amber-600 font-semibold' : 'font-medium'}>
                        {selectedProductStock} units
                      </span>
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label.Root htmlFor="qty" className="text-sm font-medium text-gray-700">Quantity to add</Label.Root>
                  <input id="qty" required type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>

                <div className="flex gap-2 pt-1 justify-end">
                  <Dialog.Close asChild>
                    <button type="button" className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">Cancel</button>
                  </Dialog.Close>
                  <button type="submit" disabled={saving || !productId}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    {saving ? 'Saving…' : 'Confirm'}
                  </button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* ── Low stock restock panel ───────────────────────────────── */}
      {lowStockItems.length > 0 && (
        <div className="mb-6 border border-amber-200 rounded-xl overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 flex items-center gap-2 border-b border-amber-200">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              {lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} need restocking
            </p>
          </div>
          <div className="divide-y divide-amber-100">
            {lowStockItems.map(({ product, stock }) => (
              <div key={product.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-amber-50/40 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{product.name}</p>
                  <p className="text-xs text-gray-400 font-mono">
                    {product.sku}
                    {product.specification && <span className="ml-1 text-gray-500">· {product.specification}</span>}
                  </p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                  stock === 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {stock === 0 ? 'Out of stock' : `${stock} ${product.stockUnit ?? 'left'}`}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={restockQtys[product.id] ?? ''}
                    onChange={(e) => setRestockQtys((r) => ({ ...r, [product.id]: e.target.value }))}
                    className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleQuickRestock(product.id)}
                    disabled={restocking[product.id]}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {restocking[product.id] ? '…' : 'Restock'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Transaction log ───────────────────────────────────────── */}
      {transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-500">
          <p className="text-sm">No transactions yet</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-right px-4 py-3">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {transactions.map((tx) => {
                const product = productMap[tx.productId]
                return (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium">{product?.name ?? tx.productId}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{product ? categoryMap[product.categoryId] : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[tx.type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {TYPE_LABELS[tx.type] ?? tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{tx.quantity}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  )
}
