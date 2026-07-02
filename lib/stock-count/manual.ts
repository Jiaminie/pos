import type { InventoryTransaction, Product } from '@/lib/types'

export const round2 = (n: number) => Math.round(n * 100) / 100

export type PendingAdjustment = { productId: string; delta: number }

/** Rows with a counted value and non-zero Δ (after round2). */
export function computePendingAdjustments(
  products: Product[],
  countedQtys: Record<string, string>,
  stockByProductId: Record<string, number>,
): PendingAdjustment[] {
  const items: PendingAdjustment[] = []
  for (const product of products) {
    const raw = countedQtys[product.id]?.trim()
    if (!raw) continue
    const counted = parseFloat(raw)
    if (Number.isNaN(counted)) continue
    const system = stockByProductId[product.id] ?? product.initialStock ?? 0
    const delta = round2(counted - system)
    if (delta !== 0) items.push({ productId: product.id, delta })
  }
  return items
}

export function getRowDelta(
  productId: string,
  countedQtys: Record<string, string>,
  stockByProductId: Record<string, number>,
  initialStock = 0,
): number | null {
  const raw = countedQtys[productId]?.trim()
  if (!raw) return null
  const counted = parseFloat(raw)
  if (Number.isNaN(counted)) return null
  const system = stockByProductId[productId] ?? initialStock
  return round2(counted - system)
}

export function buildAdjustmentTransactions(
  adjustments: PendingAdjustment[],
  branchId: string | undefined,
  options?: { now?: Date; createId?: () => string },
): InventoryTransaction[] {
  const now = options?.now ?? new Date()
  const createId = options?.createId ?? (() => crypto.randomUUID())
  const createdAt = now.toISOString()

  return adjustments.map(({ productId, delta }) => ({
    id: createId(),
    type: 'ADJUSTMENT',
    source: 'CORRECTION',
    productId,
    quantity: delta,
    branchId,
    createdAt,
  }))
}
