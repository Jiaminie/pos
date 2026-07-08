import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, requirePermission } from '@/lib/server/auth/guard'
import { applyServerStockDelta } from '@/lib/server/stockAccumulation'

// Stock counts are not stored as discrete sessions — they are the ADJUSTMENT
// transactions produced when a count is submitted. This route reconstructs the
// history by grouping those adjustments per local calendar day, and rebuilds the
// full expected/counted/variance report for any one day on demand.

// The business operates in Kenya; group counts by the branch's local calendar day
// so an evening count never straddles two UTC dates.
const TIMEZONE = 'Africa/Nairobi'
const DAY_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
/** Local (Africa/Nairobi) YYYY-MM-DD key for a timestamp. */
function localDayKey(d: Date): string {
  return DAY_FMT.format(d)
}
/** Start/end instants of a local YYYY-MM-DD day, as UTC Dates. */
function localDayBounds(date: string): { start: Date; end: Date } {
  return {
    start: new Date(`${date}T00:00:00.000+03:00`),
    end: new Date(`${date}T23:59:59.999+03:00`),
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const DEFAULT_LOOKBACK_DAYS = 120

export async function GET(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user
  const denied = await requirePermission(user, 'stock.count.adjust')
  if (!isAuthUser(denied)) return denied

  const { searchParams } = new URL(request.url)
  const requestedBranch = searchParams.get('branchId')
  const date = searchParams.get('date')

  // Resolve the branch to report on. Non-owners are locked to their own branch;
  // owners may target any branch but must have one selected (counts are per-branch).
  let branchId: string | null
  if (user.role === 'OWNER') {
    branchId = requestedBranch ?? user.branchId ?? null
  } else {
    branchId = user.branchId ?? null
    if (requestedBranch && requestedBranch !== branchId) {
      return Response.json({ data: null, error: 'Forbidden — branch mismatch' }, { status: 403 })
    }
  }
  if (!branchId) {
    return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
  }

  try {
    // ── Single-day report: rebuild expected/counted/variance for one count day ──
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return Response.json({ data: null, error: 'date must be YYYY-MM-DD' }, { status: 400 })
      }
      const { start, end } = localDayBounds(date)

      const dayAdjustments = await prisma.inventoryTransaction.findMany({
        where: { branchId, type: 'ADJUSTMENT', createdAt: { gte: start, lte: end } },
        select: { productId: true, quantity: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })

      if (dayAdjustments.length === 0) {
        return Response.json({ data: { date, branchId, rows: [] }, error: null })
      }

      const productIds = [...new Set(dayAdjustments.map((a) => a.productId))]

      // Every transaction (any type) for the affected products up to the end of
      // this day — needed to reconstruct the system stock just before the count.
      const priorTxns = await prisma.inventoryTransaction.findMany({
        where: { branchId, productId: { in: productIds }, createdAt: { lte: end } },
        select: { productId: true, type: true, quantity: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      })

      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, sku: true },
      })
      const productById = new Map(products.map((p) => [p.id, p]))

      // Walk chronologically; stock is derived purely from transactions (base 0).
      const running = new Map<string, number>()
      const expectedBefore = new Map<string, number>()
      const netDelta = new Map<string, number>()
      for (const tx of priorTxns) {
        const pid = tx.productId
        const before = running.get(pid) ?? 0
        const qty = Number(tx.quantity)
        const inDay = tx.type === 'ADJUSTMENT' && tx.createdAt >= start && tx.createdAt <= end
        if (inDay) {
          if (!expectedBefore.has(pid)) expectedBefore.set(pid, before)
          netDelta.set(pid, (netDelta.get(pid) ?? 0) + qty)
        }
        running.set(pid, applyServerStockDelta(before, tx.type, qty))
      }

      const rows = productIds
        .map((pid) => {
          const p = productById.get(pid)
          const expected = round2(expectedBefore.get(pid) ?? 0)
          const delta = round2(netDelta.get(pid) ?? 0)
          return {
            productId: pid,
            name: p?.name ?? '(deleted product)',
            sku: p?.sku ?? '',
            expected,
            counted: round2(expected + delta),
            delta,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      return Response.json({ data: { date, branchId, rows }, error: null })
    }

    // ── List mode: one summary row per local day that had count activity ──
    const to = searchParams.get('to')
    const from = searchParams.get('from')
    const rangeStart = from
      ? localDayBounds(from).start
      : new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const rangeEnd = to ? localDayBounds(to).end : new Date()

    const adjustments = await prisma.inventoryTransaction.findMany({
      where: { branchId, type: 'ADJUSTMENT', createdAt: { gte: rangeStart, lte: rangeEnd } },
      select: { productId: true, quantity: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    type DayAgg = { date: string; adjustments: number; products: Set<string>; netVariance: number; firstAt: Date; lastAt: Date }
    const byDay = new Map<string, DayAgg>()
    for (const a of adjustments) {
      const key = localDayKey(a.createdAt)
      const agg = byDay.get(key) ?? {
        date: key,
        adjustments: 0,
        products: new Set<string>(),
        netVariance: 0,
        firstAt: a.createdAt,
        lastAt: a.createdAt,
      }
      agg.adjustments += 1
      agg.products.add(a.productId)
      agg.netVariance += Number(a.quantity)
      if (a.createdAt < agg.firstAt) agg.firstAt = a.createdAt
      if (a.createdAt > agg.lastAt) agg.lastAt = a.createdAt
      byDay.set(key, agg)
    }

    const days = [...byDay.values()]
      .map((d) => ({
        date: d.date,
        adjustments: d.adjustments,
        productCount: d.products.size,
        netVariance: round2(d.netVariance),
        firstAt: d.firstAt.toISOString(),
        lastAt: d.lastAt.toISOString(),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    return Response.json({ data: { branchId, days }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
