import { NextRequest } from 'next/server'
import type { StockCountUpload } from '@prisma/client'
import { prisma } from '@/lib/server/db'
import { assertBranchAccess, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'
import { resolveStockCountBranchId } from '@/lib/server/stock-count/branch'
import { mapWithConcurrency } from '@/lib/server/stock-count/concurrency'
import { isValidStockCountImageUrl } from '@/lib/server/stock-count/cloudinary'
import { extractStockCountRows } from '@/lib/server/stock-count/extract'
import { checkExtractRateLimit } from '@/lib/server/stock-count/rateLimit'
import { RESUMABLE_DRAFT_STATUSES } from '@/lib/stock-count/types'

const MAX_IMAGES = 10
const EXTRACT_CONCURRENCY = 3

type IncomingImage = {
  url: string
  filename?: string
}

export async function GET(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'stock.count.adjust')
  if (!isAuthUser(user)) return user

  try {
    const branchId = new URL(request.url).searchParams.get('branchId')
    if (!branchId) {
      return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
    }

    const branchErr = assertBranchAccess(user, branchId)
    if (branchErr) return branchErr

    const uploads = await prisma.stockCountUpload.findMany({
      where: {
        branchId,
        uploadedById: user.userId,
        status: { in: [...RESUMABLE_DRAFT_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
    })

    return Response.json({ data: { uploads }, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'stock.count.adjust')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const branchId = resolveStockCountBranchId(body.branchId, user)
    if (!branchId) {
      return Response.json(
        { data: null, error: 'branchId is required' },
        { status: 400 },
      )
    }

    const branchErr = assertBranchAccess(user, branchId)
    if (branchErr) return branchErr

    if (!Array.isArray(body.images)) {
      return Response.json(
        { data: null, error: 'images must be an array' },
        { status: 400 },
      )
    }

    if (body.images.length === 0) {
      return Response.json(
        { data: null, error: 'At least one image is required' },
        { status: 400 },
      )
    }

    if (body.images.length > MAX_IMAGES) {
      return Response.json(
        { data: null, error: `At most ${MAX_IMAGES} images per request` },
        { status: 400 },
      )
    }

    const images = body.images as IncomingImage[]
    const invalidUrls = images.filter((img) => !img?.url || !isValidStockCountImageUrl(img.url))
    if (invalidUrls.length > 0) {
      return Response.json(
        {
          data: null,
          error: 'One or more image URLs are invalid — must be HTTPS Cloudinary URLs in pos/stock-count/',
        },
        { status: 400 },
      )
    }

    const rate = await checkExtractRateLimit(user.userId)
    if (!rate.ok) {
      return Response.json(
        { data: null, error: 'Too many extraction requests — try again shortly' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)) },
        },
      )
    }

    const uploads = await mapWithConcurrency(images, EXTRACT_CONCURRENCY, async (image) =>
      processOneImage(user.userId, branchId, image.url),
    )

    return Response.json({ data: { uploads }, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

async function processOneImage(
  uploadedById: string,
  branchId: string,
  imageUrl: string,
): Promise<StockCountUpload> {
  const upload = await prisma.stockCountUpload.create({
    data: {
      branchId,
      uploadedById,
      imageUrl,
      status: 'PENDING',
    },
  })

  try {
    const rows = await extractStockCountRows(imageUrl)
    return await prisma.stockCountUpload.update({
      where: { id: upload.id },
      data: {
        status: 'EXTRACTED',
        extractedRows: rows,
        errorMessage: null,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed'
    try {
      return await prisma.stockCountUpload.update({
        where: { id: upload.id },
        data: {
          status: 'ERROR',
          errorMessage: message,
        },
      })
    } catch {
      // Couldn't even persist the ERROR status (e.g. DB is unreachable) — return
      // a best-effort row instead of throwing, so one image's DB hiccup doesn't
      // fail mapWithConcurrency's Promise.all and discard every other image's
      // already-successful extraction in this same batch.
      return { ...upload, status: 'ERROR', errorMessage: message }
    }
  }
}
