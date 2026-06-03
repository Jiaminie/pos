'use client'

import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Minus, Plus, ShoppingCart, WifiOff, X } from 'lucide-react'
import { create } from '@/lib/db/transactions'
import { push } from '@/lib/db/syncQueue'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getCategories } from '@/lib/db/categories'
import { seedIfEmpty } from '@/lib/db/seed'
import type { Product, ProductCategory, InventoryTransaction } from '@/lib/types'

type CartItem = Product & { qty: number }

export default function POSPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [activeCategoryId, setActiveCategoryId] = useState<string>('all')
  const [cart, setCart] = useState<CartItem[]>([])
  const [offline, setOffline] = useState(false)
  const [receipt, setReceipt] = useState<{ orderId: string; items: CartItem[]; total: number } | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  useEffect(() => {
    async function load() {
      await seedIfEmpty()
      const [cats, prods] = await Promise.all([getCategories(), getProducts()])
      setCategories(cats)
      setProducts(prods)
      if (cats.length > 0) setActiveCategoryId(cats[0].id)
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
    }
    setReceipt({ orderId, items: [...cart], total: subtotal })
    setCart([])
    setChecking(false)
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

          {/* Category tabs */}
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
              {visible.map((p) => (
                <button key={p.id} onClick={() => addToCart(p)}
                  className="text-left border border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <p className="font-medium text-sm leading-snug">{p.name}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{p.sku}</p>
                  <p className="text-blue-600 font-semibold mt-2">KES {p.sellingPrice.toLocaleString()}</p>
                </button>
              ))}
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
          <button onClick={checkout} disabled={cart.length === 0 || checking}
            className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {checking ? 'Processing…' : 'Checkout'}
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
    </div>
  )
}
