import type { Incident } from '../types'
import { openDb } from './idb'
import { getDeviceId } from '../device'

export async function getAll(): Promise<Incident[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction('incidents', 'readonly').objectStore('incidents').getAll()
    req.onsuccess = () => resolve((req.result as Incident[]).reverse())
    req.onerror = () => reject(req.error)
  })
}

export async function create(incident: Incident): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('incidents', 'readwrite')
    tx.objectStore('incidents').add(incident)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function createMany(items: Incident[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('incidents', 'readwrite')
    const store = tx.objectStore('incidents')
    for (const item of items) store.add(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function push(incident: Incident): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('incidentQueue', 'readwrite')
    tx.objectStore('incidentQueue').put(incident)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function pushMany(items: Incident[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('incidentQueue', 'readwrite')
    const store = tx.objectStore('incidentQueue')
    for (const item of items) store.put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function drain(batchSize = 100): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return

  const db = await openDb()
  const items = await new Promise<Incident[]>((resolve, reject) => {
    const req = db.transaction('incidentQueue', 'readonly').objectStore('incidentQueue').getAll()
    req.onsuccess = () => resolve(req.result as Incident[])
    req.onerror = () => reject(req.error)
  })

  if (items.length === 0) return

  const deviceId = getDeviceId()
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batch = items.slice(offset, offset + batchSize)
    const payload = batch.map((inc) => ({
      id: inc.id,
      productId: inc.productId ?? null,
      productName: inc.productName,
      reason: inc.reason,
      note: inc.note ?? null,
      deviceId,
      createdAt: inc.createdAt,
    }))

    const res = await fetch('/api/incidents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) return

    const syncedIds = new Set(batch.map((i) => i.id))
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('incidentQueue', 'readwrite')
      const store = tx.objectStore('incidentQueue')
      syncedIds.forEach((id) => store.delete(id))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }
}
