import { prisma } from '@/lib/server/db'

const WINDOW_MS = 60_000
const MAX_EXTRACT_REQUESTS_PER_WINDOW = 10

/**
 * Backed by StockCountUpload row creation (one row = one Claude vision call),
 * not an in-memory counter — a module-level Map doesn't share state across
 * concurrent or cold-started serverless instances, which would let the limit
 * be bypassed almost entirely in production. Counting persisted rows is also
 * a more accurate cost throttle than counting HTTP requests, since a single
 * request can bundle up to MAX_IMAGES vision calls.
 */
export async function checkExtractRateLimit(
  userId: string,
): Promise<{ ok: true } | { ok: false; retryAfterMs: number }> {
  const windowStart = new Date(Date.now() - WINDOW_MS)

  const recent = await prisma.stockCountUpload.findMany({
    where: { uploadedById: userId, createdAt: { gte: windowStart } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  if (recent.length >= MAX_EXTRACT_REQUESTS_PER_WINDOW) {
    const oldest = recent[0]!.createdAt.getTime()
    const retryAfterMs = Math.max(0, WINDOW_MS - (Date.now() - oldest))
    return { ok: false, retryAfterMs }
  }

  return { ok: true }
}
