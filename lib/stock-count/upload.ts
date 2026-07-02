import type { ExtractedStockCountRow, StockCountUpload } from './types'

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const MAX_PHOTOS_PER_BATCH = 10
export const STALE_DRAFT_MS = 4 * 60 * 60 * 1000

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type UploadSignature = {
  signature: string
  timestamp: number
  apiKey: string
  cloudName: string
  folder: string
}

export function validatePhotoFiles(files: File[]): string | null {
  if (files.length === 0) return 'Select at least one photo'
  if (files.length > MAX_PHOTOS_PER_BATCH) {
    return `At most ${MAX_PHOTOS_PER_BATCH} photos per batch`
  }
  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return `${file.name}: only JPEG, PNG, and WebP are allowed`
    }
    if (file.size > MAX_PHOTO_BYTES) {
      return `${file.name}: exceeds 5 MB limit`
    }
  }
  return null
}

export async function fetchUploadSignature(): Promise<UploadSignature> {
  const res = await fetch('/api/stock-count/upload-signature', {
    method: 'POST',
    credentials: 'include',
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Failed to get upload signature')
  return json.data as UploadSignature
}

export async function uploadToCloudinary(file: File, sig: UploadSignature): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  body.append('api_key', sig.apiKey)
  body.append('timestamp', String(sig.timestamp))
  body.append('signature', sig.signature)
  body.append('folder', sig.folder)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`, {
    method: 'POST',
    body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message ?? `Upload failed for ${file.name}`)
  if (!json.secure_url) throw new Error(`Upload failed for ${file.name}`)
  return json.secure_url as string
}

export async function extractStockCountPhotos(
  branchId: string,
  images: Array<{ url: string; filename?: string }>,
): Promise<StockCountUpload[]> {
  const res = await fetch('/api/stock-count/extract', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchId, images }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Extraction failed')
  return (json.data?.uploads ?? []) as StockCountUpload[]
}

export async function fetchResumableDrafts(branchId: string): Promise<StockCountUpload[]> {
  const res = await fetch(`/api/stock-count/extract?branchId=${encodeURIComponent(branchId)}`, {
    credentials: 'include',
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Failed to load drafts')
  return (json.data?.uploads ?? []) as StockCountUpload[]
}

export async function completeStockCountUploads(
  branchId: string,
  ids: string[],
  status: 'SUBMITTED' | 'DISCARDED',
): Promise<StockCountUpload[]> {
  const res = await fetch('/api/stock-count/uploads/complete', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchId, ids, status }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Failed to update uploads')
  return (json.data?.uploads ?? []) as StockCountUpload[]
}

export function parseExtractedRows(raw: unknown): ExtractedStockCountRow[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (row): row is ExtractedStockCountRow =>
      row != null &&
      typeof row === 'object' &&
      typeof (row as ExtractedStockCountRow).description === 'string' &&
      typeof (row as ExtractedStockCountRow).qty === 'number',
  )
}

const RESOLVED_KEY_PREFIX = 'pos_stock_count_resolved_'

// Manual row→product resolutions are only kept client-side (the raw extraction
// is what's persisted server-side). Without this, reloading the page mid-review
// silently drops any row a user had already resolved, requiring it be redone.
export function loadResolvedProductMap(branchId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(RESOLVED_KEY_PREFIX + branchId)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function saveResolvedProductMap(branchId: string, map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(RESOLVED_KEY_PREFIX + branchId, JSON.stringify(map))
  } catch {
    // localStorage unavailable/full — resolved rows just won't survive a reload
  }
}

const DISMISSED_KEY_PREFIX = 'pos_stock_count_dismissed_'

// Rows the user explicitly skipped during review (a misread/junk row they don't
// want counted). Persisted for the same reason as resolutions: a reload
// shouldn't resurface rows they've already dealt with.
export function loadDismissedRowKeys(branchId: string): Record<string, true> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(DISMISSED_KEY_PREFIX + branchId)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, true>) : {}
  } catch {
    return {}
  }
}

export function saveDismissedRowKeys(branchId: string, map: Record<string, true>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DISMISSED_KEY_PREFIX + branchId, JSON.stringify(map))
  } catch {
    // localStorage unavailable/full — skipped rows just won't survive a reload
  }
}

/** SHA-256 hex of a file's bytes, used to detect a re-upload of the same image
 *  before it costs a Cloudinary upload + Claude vision call. */
export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const UPLOADED_HASH_PREFIX = 'pos_stock_count_hashes_'

// Maps a file content hash → the upload id it produced, so a duplicate image can
// be recognised across reloads. Pruned to the currently-present drafts on resume,
// so it stays bounded and only guards images still in the active count.
export function loadUploadedHashes(branchId: string): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(UPLOADED_HASH_PREFIX + branchId)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function saveUploadedHashes(branchId: string, map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(UPLOADED_HASH_PREFIX + branchId, JSON.stringify(map))
  } catch {
    // localStorage unavailable/full — dedup just won't survive a reload
  }
}

export function formatStaleAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
