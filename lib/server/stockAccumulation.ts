/** Server-side inventory vocabulary (Prisma TransactionType enum). */
export type ServerTransactionType =
  | 'SALE'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'RETURN'
  | 'TRANSFER_OUT'

export type StockGroupByRow = {
  productId: string
  type: string
  quantity: number
}

/**
 * Apply one grouped transaction sum to a running stock total.
 * ADJUSTMENT quantities are signed deltas; PURCHASE/RETURN add; SALE/TRANSFER_OUT subtract.
 */
export function applyServerStockDelta(
  prev: number,
  type: string,
  quantity: number,
): number {
  if (type === 'PURCHASE' || type === 'RETURN') return prev + quantity
  if (type === 'ADJUSTMENT') return prev + quantity
  if (type === 'SALE' || type === 'TRANSFER_OUT') return prev - quantity
  return prev
}

/** Build per-product stock from prisma.inventoryTransaction.groupBy rows. */
export function buildStockByProductFromGroupBy(
  rows: StockGroupByRow[],
): Map<string, number> {
  const stockByProduct = new Map<string, number>()
  for (const row of rows) {
    const prev = stockByProduct.get(row.productId) ?? 0
    stockByProduct.set(
      row.productId,
      applyServerStockDelta(prev, row.type, row.quantity),
    )
  }
  return stockByProduct
}
