import type { SaleLine } from '../types'
import { openDb } from './idb'

export type Sale = {
  id: string
  branchId: string
  deviceId: string
  cashierId: string
  subtotal: number
  lineDiscountTotal: number
  saleDiscountAmount: number
  total: number
  createdAt: string
  /** True when the sale was rung up while the device was offline. */
  wasOffline?: boolean
  lines: SaleLine[]
}

export async function create(sale: Sale): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('sales', 'readwrite')
    tx.objectStore('sales').put(sale)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAll(): Promise<Sale[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('sales', 'readonly').objectStore('sales').getAll()
    req.onsuccess = () => resolve(req.result as Sale[])
    req.onerror = () => reject(req.error)
  })
}
