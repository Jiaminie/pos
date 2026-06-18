import type { InventoryTransaction, Product } from './types'

export const LOW_STOCK_THRESHOLD = 5

export function buildStockByProductId(
  products: Product[],
  transactions: InventoryTransaction[],
): Record<string, number> {
  const byProductId: Record<string, number> = {}

  for (const product of products) {
    byProductId[product.id] = product.initialStock ?? 0
  }

  for (const tx of transactions) {
    const current = byProductId[tx.productId] ?? 0
    byProductId[tx.productId] = tx.type === 'STOCK_IN'
      ? current + tx.quantity
      : current - tx.quantity
  }

  return byProductId
}

export function computeStock(
  productId: string,
  transactions: InventoryTransaction[],
  initialStock = 0
): number {
  return transactions.reduce((stock, tx) => {
    if (tx.productId !== productId) return stock
    return tx.type === 'STOCK_IN' ? stock + tx.quantity : stock - tx.quantity
  }, initialStock)
}

export function getLowStockItems(
  products: Product[],
  transactions: InventoryTransaction[],
  stockByProductId?: Record<string, number>,
): Array<{ product: Product; stock: number }> {
  const stocks = stockByProductId ?? buildStockByProductId(products, transactions)
  return products
    .map((p) => ({ product: p, stock: stocks[p.id] ?? (p.initialStock ?? 0) }))
    .filter(({ stock }) => stock < LOW_STOCK_THRESHOLD)
}
