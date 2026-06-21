'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Loader2, Package, Search, X } from 'lucide-react'
import * as Select from '@radix-ui/react-select'
import { toast } from 'sonner'
import { getAll as getProducts } from '@/lib/db/products'
import { getAll as getBranches } from '@/lib/db/branches'
import { getIncoming, getOutgoing, upsert as upsertTransfer, updateStatus } from '@/lib/db/transfers'
import { create as addTransaction } from '@/lib/db/transactions'
import { push as pushToQueue } from '@/lib/db/syncQueue'
import { getMyBranchId } from '@/lib/branch'
import { getDeviceId } from '@/lib/device'
import { normalizeQuery } from '@/lib/normalize'
import type { Branch, Product, StockTransfer } from '@/lib/types'

type Tab = 'outgoing' | 'incoming'

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-amber-50  text-amber-700  border-amber-200',
  IN_TRANSIT:'bg-blue-50   text-blue-700   border-blue-200',
  RECEIVED:  'bg-green-50  text-green-700  border-green-200',
  REJECTED:  'bg-red-50    text-red-700    border-red-200',
  REVERSED:  'bg-gray-50   text-gray-600   border-gray-200',
}

export default function TransfersPage() {
  const [tab, setTab]               = useState<Tab>('outgoing')
  const [branches, setBranches]     = useState<Branch[]>([])
  const [products, setProducts]     = useState<Product[]>([])
  const [incoming, setIncoming]     = useState<StockTransfer[]>([])
  const [outgoing, setOutgoing]     = useState<StockTransfer[]>([])
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)

  // Dispatch form state
  const [search, setSearch]         = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [qty, setQty]               = useState('')
  const [destBranchId, setDestBranchId] = useState('')
  const [note, setNote]             = useState('')
  const [dispatching, setDispatching] = useState(false)

  // Action state
  const [confirming, setConfirming] = useState<string | null>(null)
  const [rejecting, setRejecting]   = useState<string | null>(null)

  useEffect(() => {
    const branchId = getMyBranchId()
    setMyBranchId(branchId)
    Promise.all([
      getBranches(),
      getProducts(),
      branchId ? getIncoming(branchId) : Promise.resolve([]),
      branchId ? getOutgoing(branchId) : Promise.resolve([]),
    ]).then(([b, p, inc, out]) => {
      setBranches(b)
      setProducts(p)
      setIncoming(inc)
      setOutgoing(out)
      setLoading(false)
    })
  }, [])

  const otherBranches = branches.filter((b) => b.id !== myBranchId)

  const filteredProducts = search.trim()
    ? products.filter((p) => {
        const q = normalizeQuery(search)
        return (
          normalizeQuery(p.name).includes(q) ||
          normalizeQuery(p.sku).includes(q)
        )
      }).slice(0, 8)
    : []

  async function handleDispatch() {
    if (!selectedProduct || !qty || !destBranchId || !myBranchId) {
      toast.error('Select a product, quantity, and destination branch')
      return
    }
    const quantity = parseFloat(qty)
    if (isNaN(quantity) || quantity <= 0) { toast.error('Quantity must be positive'); return }

    setDispatching(true)
    try {
      const deviceId = getDeviceId()
      const res = await fetch('/api/transfers', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          fromBranchId: myBranchId,
          toBranchId:   destBranchId,
          productId:    selectedProduct.id,
          quantity,
          note:         note.trim() || null,
          fromDeviceId: deviceId,
        }),
      })

      const { data, error } = await res.json()
      if (!res.ok) { toast.error(error ?? 'Dispatch failed'); return }

      // Write returned records to local IDB immediately
      const transfer: StockTransfer = {
        id:           data.transfer.id,
        fromBranchId: data.transfer.fromBranchId,
        toBranchId:   data.transfer.toBranchId,
        productId:    data.transfer.productId,
        quantity:     Number(data.transfer.quantity),
        status:       data.transfer.status,
        note:         data.transfer.note ?? undefined,
        fromDeviceId: data.transfer.fromDeviceId,
        createdAt:    new Date(data.transfer.createdAt).toISOString(),
      }
      await upsertTransfer(transfer)

      const tx = {
        id:        data.transaction.id,
        productId: selectedProduct.id,
        type:      'TRANSFER_OUT' as const,
        quantity,
        branchId:  myBranchId,
        createdAt: new Date(data.transaction.createdAt).toISOString(),
      }
      await addTransaction(tx)
      await pushToQueue(tx)

      setOutgoing((prev) => [transfer, ...prev])
      setSelectedProduct(null)
      setSearch('')
      setQty('')
      setDestBranchId('')
      setNote('')

      const dest = branches.find((b) => b.id === destBranchId)
      toast.success(`Dispatched ${quantity} ${selectedProduct.name} to ${dest?.name ?? 'branch'}`)
    } catch {
      toast.error('Dispatch failed — check your connection')
    } finally {
      setDispatching(false)
    }
  }

  async function handleConfirm(transfer: StockTransfer) {
    setConfirming(transfer.id)
    try {
      const deviceId = getDeviceId()
      const res = await fetch(`/api/transfers/${transfer.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'confirm', deviceId }),
      })
      const { data, error } = await res.json()
      if (!res.ok) { toast.error(error ?? 'Confirm failed'); return }

      await updateStatus(transfer.id, 'RECEIVED', new Date().toISOString())

      const tx = {
        id:            data.transaction.id,
        productId:     transfer.productId,
        type:          'STOCK_IN' as const,
        quantity:      Number(transfer.quantity),
        source:        'INTERBRANCH' as const,
        sourceBranchId: transfer.fromBranchId,
        branchId:      transfer.toBranchId,
        createdAt:     new Date(data.transaction.createdAt).toISOString(),
      }
      await addTransaction(tx)
      await pushToQueue(tx)

      setIncoming((prev) => prev.filter((t) => t.id !== transfer.id))
      toast.success('Transfer confirmed — stock updated')
    } catch {
      toast.error('Confirm failed — check your connection')
    } finally {
      setConfirming(null)
    }
  }

  async function handleReject(transfer: StockTransfer) {
    setRejecting(transfer.id)
    try {
      const deviceId = getDeviceId()
      const res = await fetch(`/api/transfers/${transfer.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'reject', deviceId }),
      })
      const { error } = await res.json()
      if (!res.ok) { toast.error(error ?? 'Reject failed'); return }

      await updateStatus(transfer.id, 'REJECTED')
      setIncoming((prev) => prev.filter((t) => t.id !== transfer.id))
      toast.success("Transfer rejected — sender's stock will be restored")
    } catch {
      toast.error('Reject failed — check your connection')
    } finally {
      setRejecting(null)
    }
  }

  const myBranch = branches.find((b) => b.id === myBranchId)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 px-5 py-4 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Stock Transfers</h1>
            {myBranch && (
              <p className="text-xs text-gray-500 mt-0.5">
                Branch: <span className="font-medium text-gray-700">{myBranch.name}</span>
              </p>
            )}
          </div>
          <div className="flex gap-1 border border-gray-200 rounded-lg p-0.5 bg-gray-50">
            {(['outgoing', 'incoming'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                  tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t}
                {t === 'incoming' && incoming.length > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                    {incoming.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-6">

          {/* ── OUTGOING TAB ── */}
          {tab === 'outgoing' && (
            <div className="space-y-6">
              <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-800">Send stock to another branch</h3>

                {/* Product search */}
                {!selectedProduct ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-gray-700">Product</label>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or SKU…"
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {filteredProducts.length > 0 && (
                      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
                        {filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setSelectedProduct(p); setSearch('') }}
                            className="w-full text-left px-3 py-2.5 hover:bg-blue-50 transition-colors flex items-center gap-2"
                          >
                            <Package size={14} className="text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm text-gray-900 truncate">{p.name}</p>
                              <p className="text-xs text-gray-500">{p.sku}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <Package size={14} className="text-blue-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-blue-900 truncate">{selectedProduct.name}</p>
                      <p className="text-xs text-blue-700">{selectedProduct.sku}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedProduct(null)}>
                      <X size={14} className="text-blue-500 hover:text-blue-700" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-700">Quantity</label>
                    <input
                      type="number"
                      min="0.001"
                      step="any"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-700">Destination branch</label>
                    <Select.Root value={destBranchId} onValueChange={setDestBranchId}>
                      <Select.Trigger className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <Select.Value placeholder="Select branch…" />
                        <Select.Icon><ChevronDown size={14} className="text-gray-400" /></Select.Icon>
                      </Select.Trigger>
                      <Select.Portal>
                        <Select.Content className="z-[60] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden" position="popper" sideOffset={4}>
                          <Select.Viewport className="p-1">
                            {otherBranches.map((b) => (
                              <Select.Item
                                key={b.id}
                                value={b.id}
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg cursor-pointer hover:bg-blue-50 outline-none data-[highlighted]:bg-blue-50"
                              >
                                <Select.ItemText>
                                  {b.name} <span className="text-xs text-gray-500 font-mono">[{b.code}]</span>
                                </Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.Viewport>
                        </Select.Content>
                      </Select.Portal>
                    </Select.Root>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-medium text-gray-700">
                    Note <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Replacement for damaged batch"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleDispatch}
                  disabled={dispatching || !selectedProduct || !qty || !destBranchId}
                  className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {dispatching
                    ? <><Loader2 size={14} className="animate-spin" /> Dispatching…</>
                    : <><ArrowRight size={14} /> Dispatch stock</>
                  }
                </button>
              </section>

              {outgoing.length > 0 && (
                <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-800">Recent outgoing</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {outgoing.slice(0, 20).map((t) => {
                      const product = products.find((p) => p.id === t.productId)
                      const toBranch = branches.find((b) => b.id === t.toBranchId)
                      return (
                        <div key={t.id} className="flex items-start gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-gray-900 font-medium">{product?.name ?? t.productId}</p>
                            <p className="text-xs text-gray-500">
                              {t.quantity} → {toBranch?.name ?? t.toBranchId}
                            </p>
                            <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()}</p>
                          </div>
                          <span className={`shrink-0 text-[10px] font-medium border rounded-full px-2 py-0.5 ${STATUS_COLORS[t.status] ?? ''}`}>
                            {t.status}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ── INCOMING TAB ── */}
          {tab === 'incoming' && (
            <div className="space-y-4">
              {incoming.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Check size={32} className="mx-auto mb-3 text-green-400" />
                  <p className="text-sm">No pending incoming transfers</p>
                </div>
              ) : (
                incoming.map((t) => {
                  const product   = products.find((p) => p.id === t.productId)
                  const fromBranch = branches.find((b) => b.id === t.fromBranchId)
                  return (
                    <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{product?.name ?? t.productId}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            <span className="font-medium">{t.quantity}</span> units from{' '}
                            <span className="font-medium">{fromBranch?.name ?? t.fromBranchId}</span>
                          </p>
                          {t.note && <p className="text-xs text-gray-400 mt-0.5 italic">"{t.note}"</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{new Date(t.createdAt).toLocaleDateString()}</p>
                        </div>
                        <span className={`shrink-0 text-[10px] font-medium border rounded-full px-2 py-0.5 ${STATUS_COLORS[t.status] ?? ''}`}>
                          {t.status}
                        </span>
                      </div>
                      <div className="flex gap-2 pt-1 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => handleConfirm(t)}
                          disabled={confirming === t.id || !!rejecting}
                          className="flex items-center gap-1.5 bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-60"
                        >
                          {confirming === t.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <Check size={12} />}
                          Confirm receipt
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(t)}
                          disabled={rejecting === t.id || !!confirming}
                          className="flex items-center gap-1.5 border border-red-200 text-red-600 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors disabled:opacity-60"
                        >
                          {rejecting === t.id
                            ? <Loader2 size={12} className="animate-spin" />
                            : <X size={12} />}
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
