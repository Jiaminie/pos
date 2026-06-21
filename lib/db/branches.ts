import type { Branch } from '../types'
import { openDb } from './idb'

export async function getAll(): Promise<Branch[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('branches', 'readonly').objectStore('branches').getAll()
    req.onsuccess = () => resolve(req.result as Branch[])
    req.onerror   = () => reject(req.error)
  })
}

export async function getById(id: string): Promise<Branch | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('branches', 'readonly').objectStore('branches').get(id)
    req.onsuccess = () => resolve(req.result as Branch | undefined)
    req.onerror   = () => reject(req.error)
  })
}

export async function getPrimary(): Promise<Branch | undefined> {
  const all = await getAll()
  return all.find((b) => b.isPrimary)
}

export async function upsertMany(branches: Branch[]): Promise<void> {
  if (branches.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('branches', 'readwrite')
    const store = tx.objectStore('branches')
    for (const branch of branches) store.put(branch)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function replaceAll(branches: Branch[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('branches', 'readwrite')
    const store = tx.objectStore('branches')
    store.clear()
    for (const branch of branches) store.add(branch)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}
