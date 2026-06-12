export type CatalogSyncPhase = 'categories' | 'download' | 'write' | 'done' | 'error'

export type CatalogSyncProgress = {
  phase: CatalogSyncPhase
  message: string
  productsLoaded: number
  totalProducts?: number
  categoriesLoaded: number
  batchIndex: number
  recentNames: string[]
  elapsedMs: number
}

export const SYNC_TIPS = [
  'First sync after a bulk import can take a minute — your catalog is large.',
  'Products are saved on this device so the POS works offline.',
  'Stock counts from your Excel file are included in each product.',
  'You can keep using other tabs — just leave this one open.',
  'Almost there — we download in small batches so nothing times out.',
] as const

export function initialSyncProgress(): CatalogSyncProgress {
  return {
    phase: 'categories',
    message: 'Connecting to server…',
    productsLoaded: 0,
    categoriesLoaded: 0,
    batchIndex: 0,
    recentNames: [],
    elapsedMs: 0,
  }
}
