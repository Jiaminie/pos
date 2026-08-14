import type { Organization } from '../types'
import { openDb, settleTx } from './idb'

export async function getAll(): Promise<Organization[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('organizations', 'readonly').objectStore('organizations').getAll()
    req.onsuccess = () => resolve(req.result as Organization[])
    req.onerror  = () => reject(req.error)
  })
}

export async function upsertMany(orgs: Organization[]): Promise<void> {
  if (orgs.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('organizations', 'readwrite')
    const store = tx.objectStore('organizations')
    for (const org of orgs) store.put(org)
    settleTx(tx, resolve, reject)
  })
}

export async function replaceAll(orgs: Organization[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('organizations', 'readwrite')
    const store = tx.objectStore('organizations')
    store.clear()
    for (const org of orgs) store.put(org)
    settleTx(tx, resolve, reject)
  })
}
