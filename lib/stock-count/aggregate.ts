import { matchProduct } from './match'
import { round2 } from './manual'
import { parseExtractedRows } from './upload'
import type { ExtractedStockCountRow, StockCountUpload, UnmatchedReviewRow } from './types'
import type { Product } from '@/lib/types'

/** Manual per-row corrections, keyed by rowKey. Overrides the transcribed row
 *  (notably its quantity) everywhere counts are computed, so an edited qty isn't
 *  silently reverted to the original on resume/discard/submit. */
export type RowEditsByKey = Record<string, ExtractedStockCountRow>

export function rowKey(uploadId: string, index: number): string {
  return `${uploadId}:${index}`
}

type MatchedRow = {
  key: string
  row: ExtractedStockCountRow
  productId: string | null
  status: 'matched' | 'needs_review' | 'unmatched'
  suggestedProductId: string | null
  suggestedProductName: string | null
}

/** Resolves each row of one upload to a product once — either a manual override
 *  (resolvedProductByKey) or the auto-matcher's best guess — so callers don't
 *  each redo the same O(rows x products) fuzzy match independently. */
function matchUploadRows(
  upload: StockCountUpload,
  products: Product[],
  resolvedProductByKey: Record<string, string>,
  rowEditsByKey: RowEditsByKey = {},
): MatchedRow[] {
  const rows = parseExtractedRows(upload.extractedRows)
  if (upload.status !== 'EXTRACTED' || rows.length === 0) return []

  return rows.map((parsed, index) => {
    const key = rowKey(upload.id, index)
    const resolvedId = resolvedProductByKey[key] ?? null
    // Auto-match on the ORIGINAL transcription: an edited-but-unresolved row must
    // stay in the review queue for explicit confirm, not silently auto-count.
    const match = matchProduct(parsed.description, products)
    const autoMatchedId = match.status === 'matched' ? match.productId : null

    return {
      key,
      // Edited row (esp. quantity) feeds aggregation + display; a resolved row's
      // corrected qty is what actually lands in / comes back out of the count.
      row: rowEditsByKey[key] ?? parsed,
      productId: resolvedId ?? autoMatchedId,
      status: match.status,
      suggestedProductId: match.productId,
      suggestedProductName: match.productName,
    }
  })
}

export function computeUploadAggregates(
  upload: StockCountUpload,
  products: Product[],
  resolvedProductByKey: Record<string, string>,
  rowEditsByKey: RowEditsByKey = {},
): Map<string, number> {
  const aggregates = new Map<string, number>()
  for (const { productId, row } of matchUploadRows(
    upload,
    products,
    resolvedProductByKey,
    rowEditsByKey,
  )) {
    if (!productId) continue
    aggregates.set(productId, round2((aggregates.get(productId) ?? 0) + row.qty))
  }
  return aggregates
}

export function computeAllPhotoAggregates(
  uploads: StockCountUpload[],
  products: Product[],
  resolvedProductByKey: Record<string, string>,
  rowEditsByKey: RowEditsByKey = {},
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const upload of uploads) {
    for (const [productId, qty] of computeUploadAggregates(
      upload,
      products,
      resolvedProductByKey,
      rowEditsByKey,
    )) {
      totals.set(productId, round2((totals.get(productId) ?? 0) + qty))
    }
  }
  return totals
}

export function buildUnmatchedReviewRows(
  uploads: StockCountUpload[],
  products: Product[],
  resolvedProductByKey: Record<string, string>,
): UnmatchedReviewRow[] {
  const rows: UnmatchedReviewRow[] = []

  for (const upload of uploads) {
    for (const matched of matchUploadRows(upload, products, resolvedProductByKey)) {
      if (resolvedProductByKey[matched.key]) continue
      if (matched.status === 'matched') continue

      rows.push({
        key: matched.key,
        uploadId: upload.id,
        imageUrl: upload.imageUrl,
        row: matched.row,
        status: matched.status,
        suggestedProductId: matched.suggestedProductId,
        suggestedProductName: matched.suggestedProductName,
      })
    }
  }

  return rows
}

export function subtractAggregates(
  counts: Record<string, string>,
  aggregates: Map<string, number>,
): Record<string, string> {
  const next = { ...counts }
  for (const [productId, qty] of aggregates) {
    const current = parseFloat(next[productId] ?? '')
    if (Number.isNaN(current)) {
      delete next[productId]
      continue
    }
    const remaining = round2(current - qty)
    if (remaining <= 0) delete next[productId]
    else next[productId] = String(remaining)
  }
  return next
}

export function mergePhotoAggregatesIntoCounts(
  counts: Record<string, string>,
  aggregates: Map<string, number>,
): Record<string, string> {
  const next = { ...counts }
  for (const [productId, qty] of aggregates) {
    const current = parseFloat(next[productId] ?? '')
    const base = Number.isNaN(current) ? 0 : current
    next[productId] = String(round2(base + qty))
  }
  return next
}

/** Upload ids whose extracted (or manually resolved) rows landed in counted qty. */
export function draftIdsThatContributedToCounts(
  uploads: StockCountUpload[],
  products: Product[],
  resolvedProductByKey: Record<string, string>,
  rowEditsByKey: RowEditsByKey = {},
): string[] {
  return uploads
    .filter(
      (upload) =>
        computeUploadAggregates(upload, products, resolvedProductByKey, rowEditsByKey).size > 0,
    )
    .map((upload) => upload.id)
}

export function clearResolvedKeysForUpload(
  resolvedProductByKey: Record<string, string>,
  uploadId: string,
): Record<string, string> {
  const prefix = `${uploadId}:`
  const next = { ...resolvedProductByKey }
  for (const key of Object.keys(next)) {
    if (key.startsWith(prefix)) delete next[key]
  }
  return next
}

export function applyResumeDraftsToCounts(
  uploads: StockCountUpload[],
  products: Product[],
  resolvedProductByKey: Record<string, string>,
  rowEditsByKey: RowEditsByKey = {},
): Map<string, number> {
  const extracted = uploads.filter((u) => u.status === 'EXTRACTED')
  return computeAllPhotoAggregates(extracted, products, resolvedProductByKey, rowEditsByKey)
}
