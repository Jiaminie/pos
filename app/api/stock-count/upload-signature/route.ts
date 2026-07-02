import { NextRequest } from 'next/server'
import { isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'
import {
  cloudinaryEnvReady,
  configureCloudinary,
  createStockCountUploadSignature,
} from '@/lib/server/stock-count/cloudinary'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'stock.count.adjust')
  if (!isAuthUser(user)) return user

  if (!cloudinaryEnvReady()) {
    return Response.json(
      { data: null, error: 'Cloudinary credentials are not configured' },
      { status: 503 },
    )
  }

  try {
    configureCloudinary()
    const payload = createStockCountUploadSignature()
    return Response.json({ data: payload, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create upload signature'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
