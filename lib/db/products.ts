import type { Product } from '../types'
import { openDb, settleTx } from './idb'

export async function upsertMany(products: Product[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite')
    const store = tx.objectStore('products')
    for (const product of products) store.put(product)
    settleTx(tx, resolve, reject)
  })
}

export async function clearAll(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite')
    tx.objectStore('products').clear()
    settleTx(tx, resolve, reject)
  })
}

export async function replaceAll(products: Product[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('products', 'readwrite')
    const store = tx.objectStore('products')
    store.clear()
    for (const product of products) store.put(product)
    settleTx(tx, resolve, reject)
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

export async function getByBrand(brand: string): Promise<Product[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const index = db
      .transaction('products', 'readonly')
      .objectStore('products')
      .index('brand')
    const req = index.getAll(brand)
    req.onsuccess = () => resolve(req.result as Product[])
    req.onerror = () => reject(req.error)
  })
}
