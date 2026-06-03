import type { ProductCategory } from '../types'
import { openDb } from './idb'

export async function upsertMany(categories: ProductCategory[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('categories', 'readwrite')
    const store = tx.objectStore('categories')
    for (const cat of categories) store.put(cat)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAll(): Promise<ProductCategory[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('categories', 'readonly').objectStore('categories').getAll()
    req.onsuccess = () => resolve(req.result as ProductCategory[])
    req.onerror = () => reject(req.error)
  })
}
