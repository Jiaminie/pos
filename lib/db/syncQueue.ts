import type { InventoryTransaction } from '../types'
import { openDb } from './idb'

export async function push(item: InventoryTransaction): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite')
    tx.objectStore('syncQueue').add(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
