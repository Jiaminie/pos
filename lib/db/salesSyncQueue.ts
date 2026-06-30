import type { Sale } from './sales'
import { openDb } from './idb'

// Offline backlog thresholds. We never BLOCK sales offline (a real outage must
// not brick a counter) — past these we warn the cashier and alert the owner.
export const BACKLOG_WARN_COUNT = 20
export const BACKLOG_WARN_VALUE = 50000 // KES

export async function push(sale: Sale): Promise<void> {
  // Stamp offline-origin so the server can flag it in the audit trail.
  const stamped: Sale =
    typeof navigator !== 'undefined' && !navigator.onLine
      ? { ...sale, wasOffline: true }
      : sale

  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('salesQueue', 'readwrite')
    tx.objectStore('salesQueue').put(stamped)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getQueued(): Promise<Sale[]> {
  const db = await openDb()
  return new Promise<Sale[]>((resolve, reject) => {
    const req = db.transaction('salesQueue', 'readonly').objectStore('salesQueue').getAll()
    req.onsuccess = () => resolve(req.result as Sale[])
    req.onerror = () => reject(req.error)
  })
}

/** Unsynced backlog — drives the offline warning banner and owner alert. */
export async function backlog(): Promise<{ count: number; value: number; level: 'ok' | 'warn' }> {
  const items = await getQueued()
  const count = items.length
  const value = items.reduce((s, x) => s + (x.total ?? 0), 0)
  const level = count >= BACKLOG_WARN_COUNT || value >= BACKLOG_WARN_VALUE ? 'warn' : 'ok'
  return { count, value, level }
}

export async function drain(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return

  const db = await openDb()
  const items = await getQueued()
  if (items.length === 0) return

  // Snapshot backlog before draining so we can alert the owner if it had grown
  // large while the device was offline.
  const before = {
    count: items.length,
    value: items.reduce((s, x) => s + (x.total ?? 0), 0),
  }
  const branchId = items[0]?.branchId

  for (const sale of items) {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(sale),
    })

    if (!res.ok) return

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('salesQueue', 'readwrite')
      tx.objectStore('salesQueue').delete(sale.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  if (before.count >= BACKLOG_WARN_COUNT || before.value >= BACKLOG_WARN_VALUE) {
    // Best-effort heads-up now that we're back online; failure is non-fatal.
    fetch('/api/alerts/offline-backlog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ branchId, count: before.count, value: before.value }),
    }).catch(() => {})
  }
}
