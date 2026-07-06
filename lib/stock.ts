import type { InventoryTransaction, Product } from './types'

export const LOW_STOCK_THRESHOLD = 5

/** Client-side transaction vocabulary — ADJUSTMENT quantity is a signed delta. */
export function applyClientStockDelta(
  stock: number,
  type: InventoryTransaction['type'],
  quantity: number,
): number {
  if (type === 'STOCK_IN' || type === 'ADJUSTMENT') return stock + quantity
  return stock - quantity
}

export function buildStockByProductId(
  products: Product[],
  transactions: InventoryTransaction[],
  branchId?: string,
): Record<string, number> {
  const byProductId: Record<string, number> = {}

  for (const product of products) {
    byProductId[product.id] = product.initialStock ?? 0
  }

  // When branchId is provided, only count transactions for that branch. Legacy
  // transactions with no branchId were re-attributed to the origin branch (see
  // scripts/reattribute-legacy-stock.ts), so a branch's stock is now strictly
  // its own transactions — a new branch stays a clean slate.
  const relevant = branchId
    ? transactions.filter((tx) => tx.branchId === branchId)
    : transactions

  for (const tx of relevant) {
    const current = byProductId[tx.productId] ?? 0
    byProductId[tx.productId] = applyClientStockDelta(current, tx.type, tx.quantity)
  }

  return byProductId
}

export function computeStock(
  productId: string,
  transactions: InventoryTransaction[],
  initialStock = 0,
  branchId?: string,
): number {
  const relevant = branchId
    ? transactions.filter((tx) => tx.branchId === branchId)
    : transactions

  return relevant.reduce((stock, tx) => {
    if (tx.productId !== productId) return stock
    return applyClientStockDelta(stock, tx.type, tx.quantity)
  }, initialStock)
}

export function getLowStockItems(
  products: Product[],
  transactions: InventoryTransaction[],
  stockByProductId?: Record<string, number>,
  branchId?: string,
): Array<{ product: Product; stock: number }> {
  const stocks = stockByProductId ?? buildStockByProductId(products, transactions, branchId)
  return products
    .map((p) => ({ product: p, stock: stocks[p.id] ?? (p.initialStock ?? 0) }))
    .filter(({ stock }) => stock < LOW_STOCK_THRESHOLD)
}
