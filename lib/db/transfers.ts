import type { StockTransfer, TransferStatus } from '../types'
import { openDb } from './idb'

export async function getAll(): Promise<StockTransfer[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('transfers', 'readonly').objectStore('transfers').getAll()
    req.onsuccess = () => resolve(req.result as StockTransfer[])
    req.onerror   = () => reject(req.error)
  })
}

export async function getIncoming(branchId: string): Promise<StockTransfer[]> {
  const all = await getAll()
  return all.filter((t) => t.toBranchId === branchId && t.status === 'PENDING')
}

export async function getOutgoing(branchId: string): Promise<StockTransfer[]> {
  const all = await getAll()
  return all.filter((t) => t.fromBranchId === branchId)
}

export async function upsert(transfer: StockTransfer): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('transfers', 'readwrite')
    tx.objectStore('transfers').put(transfer)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function upsertMany(transfers: StockTransfer[]): Promise<void> {
  if (transfers.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('transfers', 'readwrite')
    const store = tx.objectStore('transfers')
    for (const t of transfers) store.put(t)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function updateStatus(
  id: string,
  status: TransferStatus,
  receivedAt?: string,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('transfers', 'readwrite')
    const store = tx.objectStore('transfers')
    const req = store.get(id)
    req.onsuccess = () => {
      const record = req.result as StockTransfer | undefined
      if (!record) { resolve(); return }
      store.put({ ...record, status, ...(receivedAt ? { receivedAt } : {}) })
    }
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
