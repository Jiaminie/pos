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
