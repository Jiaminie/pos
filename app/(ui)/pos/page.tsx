'use client'

import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Minus, Plus, ShoppingCart, WifiOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { create } from '@/lib/db/transactions'
import { push, drain } from '@/lib/db/syncQueue'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { getAll as getTransactions } from '@/lib/db/transactions'
import { seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { computeStock, getLowStockItems, LOW_STOCK_THRESHOLD } from '@/lib/stock'
import type { Product, ProductCategory, InventoryTransaction } from '@/lib/types'

type CartItem = Product & { qty: number }

interface QuoteForm {
  customerName: string
  customerEmail: string
  note: string
}

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [allTransactions, setAllTransactions] = useState<InventoryTransaction[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [offline, setOffline] = useState(false)
  const [receipt, setReceipt] = useState<{ orderId: string; items: CartItem[]; total: number } | null>(null)
  const [checking, setChecking] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [quoteForm, setQuoteForm] = useState<QuoteForm>({ customerName: '', customerEmail: '', note: '' })
  const [quoteSending, setQuoteSending] = useState(false)
  const alertedIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const onOnline = () => { setOffline(false); drain().catch(() => {}) }
    const onOffline = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    drain().catch(() => {}) // drain any queued transactions from previous offline sessions
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    async function load() {
      // Show local data immediately
      const [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      if (prods.length > 0) {
        setCategories(cats)
        setProducts(prods)
        setAllTransactions(txs)
        if (cats.length > 0) setActiveCategoryId(cats[0].id)
      } else {
        await seedIfEmpty()
        const [c, p, t] = await Promise.all([getCategories(), getProducts(), getTransactions()])
        setCategories(c)
        setProducts(p)
        setAllTransactions(t)
        if (c.length > 0) setActiveCategoryId(c[0].id)
      }
      // Background sync
      const synced = await syncFromServer()
      if (synced) {
        const [c, p, t] = await Promise.all([getCategories(), getProducts(), getTransactions()])
        setCategories(c)
        setProducts(p)
        setAllTransactions(t)
        if (c.length > 0) setActiveCategoryId(c[0].id)
      }

      // Single consolidated toast on load — never spam per-item
      const low = getLowStockItems(prods, txs)
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
    load()
  }, [])

  const visible = activeCategoryId === 'all'
    ? products
    : products.filter((p) => p.categoryId === activeCategoryId)

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id)
      if (existing) return prev.map((i) => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { ...product, qty: 1 }]
    })
  }

  function setQty(id: string, delta: number) {
    setCart((prev) =>
      prev.map((i) => i.id === id ? { ...i, qty: i.qty + delta } : i).filter((i) => i.qty > 0)
    )
  }

  const subtotal = cart.reduce((sum, i) => sum + i.sellingPrice * i.qty, 0)

  async function checkout() {
    setChecking(true)
    const orderId = crypto.randomUUID()
    const now = new Date().toISOString()
    const newTxs: InventoryTransaction[] = []

    for (const item of cart) {
      const tx: InventoryTransaction = {
        id: crypto.randomUUID(),
        type: 'SALE',
        productId: item.id,
        quantity: item.qty,
        orderId,
        createdAt: now,
      }
      await create(tx)
      await push(tx)
      newTxs.push(tx)
    }

    const updatedTxs = [...allTransactions, ...newTxs]
    setAllTransactions(updatedTxs)
    setReceipt({ orderId, items: [...cart], total: subtotal })
    setCart([])
    setChecking(false)
    drain().catch(() => {}) // flush to server immediately if online

    // After checkout: toast only for items that JUST dropped below threshold
    const nowLow = getLowStockItems(products, updatedTxs)
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
      }).catch(() => {/* silent — toast already shown */})
    }
  }

  async function handleGenerateQuote() {
    if (!quoteForm.customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    setQuoteSending(true)
    try {
      const { generateQuotationPDF } = await import('@/lib/pdf')
      const quoteRef = `QT-${Date.now().toString(36).toUpperCase()}`
      const doc = generateQuotationPDF({
        customerName: quoteForm.customerName,
        customerEmail: quoteForm.customerEmail || undefined,
        note: quoteForm.note || undefined,
        quoteRef,
        date: new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }),
        items: cart.map((i) => ({ name: i.name, sku: i.sku, specification: i.specification, stockUnit: i.stockUnit, qty: i.qty, unitPrice: i.sellingPrice })),
      })
      doc.save(`quotation-${quoteRef}.pdf`)
      toast.success('Quotation downloaded', { description: `Ref: ${quoteRef}` })
      setQuoteOpen(false)
      setQuoteForm({ customerName: '', customerEmail: '', note: '' })
    } finally {
      setQuoteSending(false)
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {offline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-amber-50 border border-amber-300 text-amber-800 text-xs px-3 py-1.5 rounded-full shadow">
          <WifiOff size={13} />
          Offline — changes saved locally
        </div>
      )}

      {/* Left: product area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <h1 className="text-2xl font-semibold tracking-tight mb-4">Point of Sale</h1>

          {categories.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              <button
                onClick={() => setActiveCategoryId('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeCategoryId === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                All
              </button>
              {categories.map((c) => (
                <button key={c.id} onClick={() => setActiveCategoryId(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeCategoryId === c.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {visible.length === 0 ? (
            <p className="text-sm text-gray-500 text-center mt-16">No products in this category</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-3">
              {visible.map((p) => {
                const stock = computeStock(p.id, allTransactions)
                const isLow = stock < LOW_STOCK_THRESHOLD
                return (
                  <button key={p.id} onClick={() => addToCart(p)}
                    className={`text-left border rounded-xl p-4 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      isLow
                        ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                        : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                    }`}>
                    <p className="font-medium text-sm leading-snug">{p.name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{p.sku}</p>
                    {p.specification && (
                      <p className="text-xs text-gray-500 mt-0.5">{p.specification}</p>
                    )}
                    <p className="text-blue-600 font-semibold mt-2">KES {p.sellingPrice.toLocaleString()}</p>
                    {isLow && (
                      <p className="text-xs text-amber-600 font-medium mt-1">
                        ⚠ {stock} {p.stockUnit ?? 'left'}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: cart */}
      <aside className="w-80 border-l border-gray-200 flex flex-col bg-gray-50">
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
            cart.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-gray-500">KES {item.sellingPrice.toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setQty(item.id, -1)} className="p-1 rounded-md hover:bg-gray-200"><Minus size={12} /></button>
                  <span className="text-sm w-5 text-center">{item.qty}</span>
                  <button onClick={() => setQty(item.id, 1)} className="p-1 rounded-md hover:bg-gray-200"><Plus size={12} /></button>
                </div>
                <span className="text-sm font-medium w-16 text-right">
                  {(item.sellingPrice * item.qty).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 space-y-3">
          <div className="flex justify-between text-sm font-semibold">
            <span>Subtotal</span>
            <span>KES {subtotal.toLocaleString()}</span>
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
                      <span>KES {(item.sellingPrice * item.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="border-t pt-3 flex justify-between font-semibold text-sm">
                  <span>Total</span>
                  <span>KES {receipt.total.toLocaleString()}</span>
                </div>
                <Dialog.Close asChild>
                  <button className="mt-5 w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">Done</button>
                </Dialog.Close>
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Customer Email (optional)</label>
                <input
                  type="email"
                  value={quoteForm.customerEmail}
                  onChange={(e) => setQuoteForm((f) => ({ ...f, customerEmail: e.target.value }))}
                  placeholder="customer@email.com"
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
              {/* Preview totals */}
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-600 space-y-1">
                {cart.map((i) => (
                  <div key={i.id} className="flex justify-between">
                    <span>{i.name} × {i.qty}</span>
                    <span>KES {(i.sellingPrice * i.qty).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold text-gray-800 border-t pt-1 mt-1">
                  <span>Total</span>
                  <span>KES {subtotal.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <Dialog.Close asChild>
                <button className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
              </Dialog.Close>
              <button
                onClick={handleGenerateQuote}
                disabled={quoteSending}
                className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                <FileText size={14} />
                {quoteSending ? 'Generating…' : 'Download PDF'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
