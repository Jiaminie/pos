import type { InventoryTransaction } from '../types'
import { openDb } from './idb'
import { getDeviceId } from '../device'
import { getMyBranchId } from '../branch'
import { removeMany as removeTransactions } from './transactions'
import { toast } from 'sonner'

type SyncResult = {
  id: string
  status: 'ok' | 'forbidden' | 'invalid_type'
  syncedAt?: string
}

export async function push(item: InventoryTransaction): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite')
    tx.objectStore('syncQueue').put(item) // put not add — idempotent on retry
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function pushMany(items: InventoryTransaction[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite')
    const store = tx.objectStore('syncQueue')
    for (const item of items) store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function drain(batchSize = 100): Promise<{ droppedIds: string[] }> {
  if (typeof window === 'undefined' || !navigator.onLine) return { droppedIds: [] }

  const db = await openDb()
  const items = await new Promise<InventoryTransaction[]>((resolve, reject) => {
    const req = db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll()
    req.onsuccess = () => resolve(req.result as InventoryTransaction[])
    req.onerror   = () => reject(req.error)
  })

  if (items.length === 0) return { droppedIds: [] }

  const deviceId  = getDeviceId()
  const branchId  = getMyBranchId()
  const allDroppedIds: string[] = []

  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize)
    const payload = batch.map((tx) => ({
      id:            tx.id,
      productId:     tx.productId,
      // STOCK_IN on client maps to PURCHASE on the server enum
      type:          tx.type === 'STOCK_IN' ? 'PURCHASE' : tx.type,
      source:        tx.source ?? null,
      sourceBranchId: tx.sourceBranchId ?? null,
      branchId:      tx.branchId ?? branchId ?? null,
      quantity:      tx.quantity,
      unitPrice:     tx.unitPrice ?? null,
      deviceId,
      createdAt:     tx.createdAt,
    }))

    const res = await fetch('/api/sync', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:    JSON.stringify(payload),
    })

    if (!res.ok) return { droppedIds: allDroppedIds }

    const json = (await res.json()) as { data?: { results?: SyncResult[] } }
    const results = json.data?.results
    if (!results) return { droppedIds: allDroppedIds }

    const deleteIds = new Set<string>()
    const droppedIds: string[] = []
    for (const r of results) {
      if (!r.id) continue
      if (r.status === 'ok' || r.status === 'forbidden' || r.status === 'invalid_type') {
        deleteIds.add(r.id)
        if (r.status === 'forbidden' || r.status === 'invalid_type') droppedIds.push(r.id)
      }
    }

    if (droppedIds.length > 0) {
      toast.warning(
        `${droppedIds.length} queued transaction${droppedIds.length === 1 ? '' : 's'} could not sync (permission denied or invalid type)`,
      )
      // Purge from the local `transactions` store too — otherwise every locally
      // computed stock figure keeps counting an adjustment the server rejected.
      await removeTransactions(droppedIds)
      allDroppedIds.push(...droppedIds)
    }

    if (deleteIds.size === 0) return { droppedIds: allDroppedIds }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite')
      const store = tx.objectStore('syncQueue')
      deleteIds.forEach((id) => store.delete(id))
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  }

  return { droppedIds: allDroppedIds }
}
