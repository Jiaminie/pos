import type { Product } from '../types'
import { openDb } from './idb'

export async function upsertMany(products: Product[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite')
    const store = tx.objectStore('products')
    for (const product of products) store.put(product)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAll(): Promise<Product[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('products', 'readonly').objectStore('products').getAll()
    req.onsuccess = () => resolve(req.result as Product[])
    req.onerror = () => reject(req.error)
  })
}

export async function getByCategory(categoryId: string): Promise<Product[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const index = db
      .transaction('products', 'readonly')
      .objectStore('products')
      .index('categoryId')
    const req = index.getAll(categoryId)
    req.onsuccess = () => resolve(req.result as Product[])
    req.onerror = () => reject(req.error)
  })
}
