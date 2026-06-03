// Shared IDB helper — opens the "pos" database with all three object stores.
// Version must be bumped here whenever a new store is added.

// Shared IDB helper — opens the "pos" database with all object stores.
// Bump DB_VERSION whenever a store or index is added.

const DB_NAME = 'pos'
const DB_VERSION = 3

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const upgradeTx = (event.target as IDBOpenDBRequest).transaction!

      // v3: drop and recreate products + categories to pick up full seed data
      if (db.objectStoreNames.contains('products')) db.deleteObjectStore('products')
      if (db.objectStoreNames.contains('categories')) db.deleteObjectStore('categories')

      const catStore = db.createObjectStore('categories', { keyPath: 'id' })
      catStore.createIndex('name', 'name', { unique: true })

      const prodStore = db.createObjectStore('products', { keyPath: 'id' })
      prodStore.createIndex('categoryId', 'categoryId')
      prodStore.createIndex('sku', 'sku', { unique: true })

      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' })
        store.createIndex('productId', 'productId')
        store.createIndex('createdAt', 'createdAt')
      }

      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' })
      }
    }

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result)
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error)
  })

  return dbPromise
}
