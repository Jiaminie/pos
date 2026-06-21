import type { InventoryTransaction } from '../types'
import { openDb } from './idb'
import { getDeviceId } from '../device'
import { getMyBranchId } from '../branch'

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

export async function drain(batchSize = 100): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return

  const db = await openDb()
  const items = await new Promise<InventoryTransaction[]>((resolve, reject) => {
    const req = db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll()
    req.onsuccess = () => resolve(req.result as InventoryTransaction[])
    req.onerror   = () => reject(req.error)
  })

  if (items.length === 0) return

  const deviceId  = getDeviceId()
  const branchId  = getMyBranchId()

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
      body:    JSON.stringify(payload),
    })

    if (!res.ok) return

    const syncedIds = new Set(batch.map((i) => i.id))
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('syncQueue', 'readwrite')
      const store = tx.objectStore('syncQueue')
      syncedIds.forEach((id) => store.delete(id))
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  }
}
