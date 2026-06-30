import { NextRequest } from 'next/server'
import { commitImport } from '@/lib/import/commit'
import type { ImportCommitOptions, ImportPreviewRow } from '@/lib/import/types'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const rows = body.rows as ImportPreviewRow[] | undefined
    const options = body.options as ImportCommitOptions | undefined

    if (!rows?.length) {
      return Response.json({ data: null, error: 'rows are required' }, { status: 400 })
    }

    if (options?.createBackup !== true) {
      return Response.json(
        { data: null, error: 'createBackup must be true before import' },
        { status: 400 },
      )
    }

    const result = await commitImport(rows, { mode: 'upsert', createBackup: true })
    return Response.json({ data: result, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
