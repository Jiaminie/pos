export type ExtractedStockCountRow = {
  description: string
  qty: number
  sizeType: string | null
  type: string | null
  company: string | null
}

export type StockCountUploadStatus =
  | 'PENDING'
  | 'EXTRACTED'
  | 'ERROR'
  | 'SUBMITTED'
  | 'DISCARDED'

/** Non-terminal statuses returned by GET /api/stock-count/extract (resume drafts). */
export const RESUMABLE_DRAFT_STATUSES = [
  'PENDING',
  'EXTRACTED',
  'ERROR',
] as const satisfies readonly StockCountUploadStatus[]

export const TERMINAL_UPLOAD_STATUSES = [
  'SUBMITTED',
  'DISCARDED',
] as const satisfies readonly StockCountUploadStatus[]

export type StockCountUpload = {
  id: string
  branchId: string
  uploadedById: string
  imageUrl: string
  status: StockCountUploadStatus
  extractedRows: ExtractedStockCountRow[] | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  submittedAt: string | null
}

export type ReviewRowStatus = 'matched' | 'needs_review' | 'unmatched'

export type UnmatchedReviewRow = {
  key: string
  uploadId: string
  imageUrl: string
  row: ExtractedStockCountRow
  status: ReviewRowStatus
  suggestedProductId: string | null
  suggestedProductName: string | null
}

export type ReviewFilter = 'all' | 'matched' | 'needs_review' | 'unmatched'

export type StockCountReportRow = {
  productId: string
  name: string
  sku: string
  expected: number
  counted: number
  delta: number
}

export type StockCountReport = {
  submittedAt: string
  branchId: string
  rows: StockCountReportRow[]
}
