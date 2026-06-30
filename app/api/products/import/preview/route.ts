import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { parseCsvText, parseWorkbookBuffer } from '@/lib/import/parse'
import { buildImportPreview } from '@/lib/import/preview'
import type { ImportPreviewRow, RawImportRow } from '@/lib/import/types'
import { DEFAULT_STOCK_PRICES_MAPPING } from '@/lib/import/types'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'catalog.product.manage')
  if (!isAuthUser(user)) return user

  try {
    const contentType = request.headers.get('content-type') ?? ''
    let rawRows: RawImportRow[] = []

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!file || !(file instanceof Blob)) {
        return Response.json({ data: null, error: 'file is required' }, { status: 400 })
      }
      const buffer = await file.arrayBuffer()
      const name = file instanceof File ? file.name.toLowerCase() : ''
      if (name.endsWith('.csv')) {
        rawRows = parseCsvText(new TextDecoder().decode(buffer))
      } else {
        rawRows = parseWorkbookBuffer(buffer, DEFAULT_STOCK_PRICES_MAPPING)
      }
    } else {
      const body = await request.json()
      if (Array.isArray(body.rows)) {
        rawRows = body.rows as RawImportRow[]
      } else {
        return Response.json({ data: null, error: 'rows array or file upload required' }, { status: 400 })
      }
    }

    const existing = await prisma.product.findMany({
      select: { id: true, sku: true },
    })

    const preview = buildImportPreview(rawRows, existing)
    return Response.json({ data: preview, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Preview failed'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export type { ImportPreviewRow }
