import type { Unit } from '../types'
import { openDb } from './idb'

export async function getAll(): Promise<Unit[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('units', 'readonly').objectStore('units').getAll()
    req.onsuccess = () => resolve(req.result as Unit[])
    req.onerror = () => reject(req.error)
  })
}

export async function upsertMany(units: Unit[]): Promise<void> {
  if (units.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('units', 'readwrite')
    const store = tx.objectStore('units')
    for (const u of units) store.put(u)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function replaceAll(units: Unit[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('units', 'readwrite')
    const store = tx.objectStore('units')
    store.clear()
    for (const u of units) store.add(u)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getByCode(code: string): Promise<Unit | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db
      .transaction('units', 'readonly')
      .objectStore('units')
      .index('code')
      .get(code)
    req.onsuccess = () => resolve(req.result as Unit | undefined)
    req.onerror = () => reject(req.error)
  })
}
