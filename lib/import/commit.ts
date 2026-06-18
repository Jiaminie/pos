import { randomUUID } from 'crypto'
import { prisma } from '@/lib/server/db'
import { createCatalogBackup } from './backup'
import { importLog } from './logger'
import type { ImportCommitOptions, ImportCommitResult, ImportPreviewRow } from './types'

import { IMPORT_BATCH_SIZE } from './constants'

const BULK_IMPORT_DEVICE_ID = 'bulk-import'
export { IMPORT_BATCH_SIZE }

export type SkuIdMap = Map<string, string>

export async function loadExistingSkuMap(): Promise<SkuIdMap> {
  const rows = await prisma.product.findMany({ select: { id: true, sku: true } })
  return new Map(rows.map((r) => [r.sku, r.id]))
}

export async function commitImportBatch(
  rows: ImportPreviewRow[],
  existingBySku: SkuIdMap,
): Promise<{
  created: number
  updated: number
  stockTransactions: number
  errors: Array<{ rowIndex: number; sku: string; message: string }>
}> {
  const result = {
    created: 0,
    updated: 0,
    stockTransactions: 0,
    errors: [] as Array<{ rowIndex: number; sku: string; message: string }>,
  }

  const validRows = rows.filter((r) => r.status !== 'error')
  if (validRows.length === 0) return result

  type ProductWrite = {
    id: string
    name: string
    sku: string
    specification: string | null
    sellingPrice: number
    costPrice: number
    lowestPrice: null
    category: string
    brand: string
    imageUrl: null
    stockUnit: string
    quantity: string | null
  }

  const creates: ProductWrite[] = []
  const updates: Array<{ sku: string; data: Omit<ProductWrite, 'id' | 'sku'> }> = []
  const stockTxs: Array<{ productId: string; quantity: number; unitPrice: number }> = []

  for (const row of validRows) {
    const data = {
      name: row.name,
      specification: row.specification ?? null,
      sellingPrice: row.sellingPrice,
      costPrice: row.costPrice,
      lowestPrice: null as null,
      category: row.category,
      brand: row.brand,
      imageUrl: null as null,
      stockUnit: 'pcs',
      quantity: row.openingStock > 0 ? `${row.openingStock} pcs` : null,
    }

    const existingId = existingBySku.get(row.sku)
    if (existingId) {
      updates.push({ sku: row.sku, data })
      result.updated++
    } else {
      const id = randomUUID()
      creates.push({ id, sku: row.sku, ...data })
      existingBySku.set(row.sku, id)
      result.created++
      if (row.openingStock > 0) {
        stockTxs.push({ productId: id, quantity: row.openingStock, unitPrice: row.costPrice })
      }
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      if (creates.length > 0) {
        await tx.product.createMany({ data: creates })
      }
      for (const { sku, data } of updates) {
        await tx.product.update({ where: { sku }, data })
      }
      if (stockTxs.length > 0) {
        await tx.inventoryTransaction.createMany({
          data: stockTxs.map((s) => ({
            productId: s.productId,
            type: 'PURCHASE' as const,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            deviceId: BULK_IMPORT_DEVICE_ID,
          })),
        })
        result.stockTransactions = stockTxs.length
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch failed'
    for (const row of validRows) {
      result.errors.push({ rowIndex: row.rowIndex, sku: row.sku, message })
    }
    result.created = 0
    result.updated = 0
    result.stockTransactions = 0
  }

  return result
}

/** @deprecated Use batched commit from the wizard for large imports. */
export async function commitImport(
  rows: ImportPreviewRow[],
  options: ImportCommitOptions,
): Promise<ImportCommitResult> {
  const validRows = rows.filter((r) => r.status !== 'error')
  const result: ImportCommitResult = {
    created: 0,
    updated: 0,
    skipped: rows.length - validRows.length,
    stockTransactions: 0,
    errors: [],
  }

  if (options.createBackup) {
    importLog('Starting catalog backup…', 'backup')
    const backup = await createCatalogBackup()
    result.backupPath = backup.backupId
    importLog(
      `Backup saved: ${backup.manifest.productCount} products, ${backup.manifest.transactionCount} transactions`,
      'backup',
    )
  }

  const existingBySku = await loadExistingSkuMap()
  importLog(`Importing ${validRows.length} products in batches of ${IMPORT_BATCH_SIZE}…`, 'import')

  for (let i = 0; i < validRows.length; i += IMPORT_BATCH_SIZE) {
    const batch = validRows.slice(i, i + IMPORT_BATCH_SIZE)
    const batchNum = Math.floor(i / IMPORT_BATCH_SIZE) + 1
    const totalBatches = Math.ceil(validRows.length / IMPORT_BATCH_SIZE)
    importLog(`Batch ${batchNum}/${totalBatches} (${batch.length} rows)…`, 'import')

    const batchResult = await commitImportBatch(batch, existingBySku)
    result.created += batchResult.created
    result.updated += batchResult.updated
    result.stockTransactions += batchResult.stockTransactions
    result.errors.push(...batchResult.errors)
  }

  importLog(
    `Import finished: ${result.created} created, ${result.updated} updated, ${result.stockTransactions} stock entries`,
    'import',
  )

  return result
}
