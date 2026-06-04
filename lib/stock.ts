import type { InventoryTransaction, Product } from './types'

export const LOW_STOCK_THRESHOLD = 5

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
  transactions: InventoryTransaction[]
): Array<{ product: Product; stock: number }> {
  return products
    .map((p) => ({ product: p, stock: computeStock(p.id, transactions, p.initialStock ?? 0) }))
    .filter(({ stock }) => stock < LOW_STOCK_THRESHOLD)
}
