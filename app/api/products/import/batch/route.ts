import { NextRequest } from 'next/server'
import { commitImportBatch, loadExistingSkuMap } from '@/lib/import/commit'
import { importLog } from '@/lib/import/logger'
import type { ImportPreviewRow } from '@/lib/import/types'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const rows = body.rows as ImportPreviewRow[] | undefined
    const batchIndex = Number(body.batchIndex ?? 0)
    const totalBatches = Number(body.totalBatches ?? 1)
    const skuMapEntries = body.skuMapEntries as Array<[string, string]> | undefined

    if (!rows?.length) {
      return Response.json({ data: null, error: 'rows are required' }, { status: 400 })
    }

    const existingBySku = skuMapEntries
      ? new Map<string, string>(skuMapEntries)
      : await loadExistingSkuMap()

    importLog(`Batch ${batchIndex + 1}/${totalBatches}: ${rows.length} rows`, 'import')
    const started = Date.now()

    const result = await commitImportBatch(rows, existingBySku)

    importLog(
      `Batch ${batchIndex + 1}/${totalBatches} done in ${((Date.now() - started) / 1000).toFixed(1)}s — +${result.created} created, +${result.updated} updated`,
      'import',
    )

    return Response.json({
      data: {
        ...result,
        skuMapEntries: [...existingBySku.entries()],
      },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch import failed'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
