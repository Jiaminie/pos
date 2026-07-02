import type { InventoryTransaction } from '../types'
import { openDb } from './idb'

export async function getAll(): Promise<InventoryTransaction[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('transactions', 'readonly').objectStore('transactions').getAll()
    req.onsuccess = () => resolve((req.result as InventoryTransaction[]).reverse())
    req.onerror = () => reject(req.error)
  })
}

export async function clearAll(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('transactions', 'readwrite')
    tx.objectStore('transactions').clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function create(tx: InventoryTransaction): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction('transactions', 'readwrite')
    idbTx.objectStore('transactions').add(tx)
    idbTx.oncomplete = () => resolve()
    idbTx.onerror = () => reject(idbTx.error)
  })
}

// Idempotent merge keyed by id — used when downloading the server transaction
// log during sync. `put` overwrites a row with the same id (a transaction this
// device created and already drained) instead of throwing like `add`.
export async function upsertMany(items: InventoryTransaction[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction('transactions', 'readwrite')
    const store = idbTx.objectStore('transactions')
    for (const item of items) store.put(item)
    idbTx.oncomplete = () => resolve()
    idbTx.onerror = () => reject(idbTx.error)
  })
}

export async function createMany(items: InventoryTransaction[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction('transactions', 'readwrite')
    const store = idbTx.objectStore('transactions')
    for (const item of items) store.add(item)
    idbTx.oncomplete = () => resolve()
    idbTx.onerror = () => reject(idbTx.error)
  })
}

// Purges transactions the server rejected (forbidden/invalid_type) during sync,
// so locally-computed stock never permanently diverges from the server's view.
export async function removeMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const idbTx = db.transaction('transactions', 'readwrite')
    const store = idbTx.objectStore('transactions')
    for (const id of ids) store.delete(id)
    idbTx.oncomplete = () => resolve()
    idbTx.onerror = () => reject(idbTx.error)
  })
}
