export type ImportColumnKey =
  | 'openingStock'
  | 'name'
  | 'category'
  | 'specification'
  | 'costPrice'
  | 'sellingPrice'
  | 'sku'

/** Positional mapping for STOCK WITH PRICES.xlsx (no header row). */
export const DEFAULT_STOCK_PRICES_MAPPING: Record<ImportColumnKey, number | null> = {
  openingStock: 0,
  name: 1,
  category: 2,
  specification: 3,
  costPrice: 5,
  sellingPrice: 6,
  sku: null,
}

export type RawImportRow = {
  rowIndex: number
  openingStock: number
  name: string
  categoryRaw: string
  specification: string
  costPrice: number
  sellingPrice: number
  sku?: string
}

export type ImportPreviewStatus = 'ok' | 'missing_price' | 'error'

export type ImportPreviewRow = {
  rowIndex: number
  name: string
  specification?: string
  sku: string
  category: string
  brand: string
  openingStock: number
  costPrice: number
  sellingPrice: number
  lowestPrice: null
  status: ImportPreviewStatus
  errors: string[]
  warnings: string[]
  action: 'create' | 'update'
  existingProductId?: string
}

export type ImportPreviewSummary = {
  total: number
  ok: number
  missingPrice: number
  errors: number
  toCreate: number
  toUpdate: number
  duplicateNameGroups: number
}

export type ImportPreviewResult = {
  rows: ImportPreviewRow[]
  summary: ImportPreviewSummary
}

export type ImportCommitOptions = {
  mode: 'upsert'
  createBackup: boolean
}

export type ImportCommitResult = {
  backupPath?: string
  created: number
  updated: number
  skipped: number
  stockTransactions: number
  errors: Array<{ rowIndex: number; sku: string; message: string }>
}
