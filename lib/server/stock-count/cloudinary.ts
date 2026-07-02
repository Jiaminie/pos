import { v2 as cloudinary } from 'cloudinary'
import { configureCloudinary, cloudinaryEnvReady } from '@/lib/server/cloudinary'

export { configureCloudinary, cloudinaryEnvReady }

export const STOCK_COUNT_FOLDER = 'pos/stock-count'

/** Reject URLs outside our account / stock-count folder before paid Claude calls. */
export function isValidStockCountImageUrl(url: string): boolean {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  if (!cloudName) return false

  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()
    if (hostname !== 'res.cloudinary.com' && !hostname.endsWith('.cloudinary.com')) {
      return false
    }

    const path = decodeURIComponent(parsed.pathname)
    if (!path.includes(`/${cloudName}/image/upload/`)) return false
    if (!path.includes(`/${STOCK_COUNT_FOLDER}/`) && !path.endsWith(`/${STOCK_COUNT_FOLDER}`)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export function createStockCountUploadSignature(): {
  signature: string
  timestamp: number
  apiKey: string
  cloudName: string
  folder: string
} {
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  const apiKey = process.env.CLOUDINARY_API_KEY
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  if (!apiSecret || !apiKey || !cloudName) {
    throw new Error('Cloudinary credentials are not configured')
  }

  const timestamp = Math.round(Date.now() / 1000)
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder: STOCK_COUNT_FOLDER },
    apiSecret,
  )

  return { signature, timestamp, apiKey, cloudName, folder: STOCK_COUNT_FOLDER }
}
