import type { InventoryTransaction } from '../types'
import { openDb } from './idb'
import { getDeviceId } from '../device'

export async function push(item: InventoryTransaction): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite')
    tx.objectStore('syncQueue').put(item) // put not add — idempotent on retry
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function drain(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return

  const db = await openDb()
  const items = await new Promise<InventoryTransaction[]>((resolve, reject) => {
    const req = db.transaction('syncQueue', 'readonly').objectStore('syncQueue').getAll()
    req.onsuccess = () => resolve(req.result as InventoryTransaction[])
    req.onerror = () => reject(req.error)
  })

  if (items.length === 0) return

  const deviceId = getDeviceId()
  const payload = items.map((tx) => ({
    id: tx.id,
    productId: tx.productId,
    // server enum doesn't have STOCK_IN — map to PURCHASE
    type: tx.type === 'STOCK_IN' ? 'PURCHASE' : tx.type,
    quantity: tx.quantity,
    deviceId,
    createdAt: tx.createdAt,
  }))

  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) return

  // Remove successfully synced items by ID
  const syncedIds = new Set(items.map((i) => i.id))
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite')
    const store = tx.objectStore('syncQueue')
    syncedIds.forEach((id) => store.delete(id))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
