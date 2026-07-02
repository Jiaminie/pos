import { openDb } from './idb'
import { toast } from 'sonner'

export type ProductSyncItem = {
  id: string
  method: 'POST' | 'PATCH'
  body: Record<string, unknown>
}

async function getQueued(): Promise<ProductSyncItem[]> {
  const db = await openDb()
  return new Promise<ProductSyncItem[]>((resolve, reject) => {
    const req = db.transaction('productSyncQueue', 'readonly').objectStore('productSyncQueue').getAll()
    req.onsuccess = () => resolve(req.result as ProductSyncItem[])
    req.onerror = () => reject(req.error)
  })
}

export async function push(item: ProductSyncItem): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('productSyncQueue', 'readwrite')
    tx.objectStore('productSyncQueue').put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function remove(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('productSyncQueue', 'readwrite')
    tx.objectStore('productSyncQueue').delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function syncOne(item: ProductSyncItem): Promise<{ ok: true } | { ok: false; permanent: boolean; error?: string }> {
  const tryPatch = async (): Promise<Response> =>
    fetch(`/api/products/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(item.body),
    })

  const tryPost = async (): Promise<Response> =>
    fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: item.id, ...item.body }),
    })

  let res = item.method === 'PATCH' ? await tryPatch() : await tryPost()

  // Offline-created product: PATCH 404 → create on server with the same client id.
  if (item.method === 'PATCH' && res.status === 404) {
    res = await tryPost()
  }

  if (res.ok) return { ok: true }

  const json = await res.json().catch(() => ({}))
  const error = typeof json.error === 'string' ? json.error : undefined
  const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
  return { ok: false, permanent, error }
}

/** Returns true when the queue is fully drained. */
export async function drain(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.onLine) return false

  const items = await getQueued()
  if (items.length === 0) return true

  for (const item of items) {
    const result = await syncOne(item)
    if (result.ok) {
      await remove(item.id)
      continue
    }

    if (result.permanent) {
      await remove(item.id)
      toast.error(result.error ?? 'Product could not sync to server')
      continue
    }

    toast.error(result.error ?? 'Saved locally — sync to server failed, will retry')
    return false
  }

  return true
}
