// Shared IDB helper — opens the "pos" database with all object stores.
// IMPORTANT: onupgradeneeded uses oldVersion to apply only the needed changes.
// Never unconditionally drop stores — that wipes user data.

const DB_NAME = 'pos'
const DB_VERSION = 6

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      const oldVersion = event.oldVersion

      // v1→v3: initial schema or early versions — safe to recreate core stores
      // (these installs never had real user data)
      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('products')) db.deleteObjectStore('products')
        if (db.objectStoreNames.contains('categories')) db.deleteObjectStore('categories')
      }

      if (!db.objectStoreNames.contains('categories')) {
        const catStore = db.createObjectStore('categories', { keyPath: 'id' })
        catStore.createIndex('name', 'name', { unique: true })
      }

      if (!db.objectStoreNames.contains('products')) {
        const prodStore = db.createObjectStore('products', { keyPath: 'id' })
        prodStore.createIndex('categoryId', 'categoryId')
        prodStore.createIndex('brand', 'brand')
        prodStore.createIndex('sku', 'sku', { unique: true })
      }

      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' })
        store.createIndex('productId', 'productId')
        store.createIndex('createdAt', 'createdAt')
      }

      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' })
      }

      // v5: incidents + incidentQueue
      if (!db.objectStoreNames.contains('incidents')) {
        const inc = db.createObjectStore('incidents', { keyPath: 'id' })
        inc.createIndex('productId', 'productId')
        inc.createIndex('createdAt', 'createdAt')
      }

      if (!db.objectStoreNames.contains('incidentQueue')) {
        db.createObjectStore('incidentQueue', { keyPath: 'id' })
      }

      // v6: brand index for catalog filtering
      if (oldVersion < 6 && db.objectStoreNames.contains('products')) {
        const prodStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('products')
        if (!prodStore.indexNames.contains('brand')) {
          prodStore.createIndex('brand', 'brand')
        }
      }
    }

    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result)
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error)
  })

  return dbPromise
}
