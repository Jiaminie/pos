export type ProductCategory = {
  id: string
  name: string // e.g. "Plumbing", "Drills", "Farm Equipment"
}

export type Product = {
  id: string
  name: string
  sku: string
  specification?: string   // size/variant e.g. "250ml", "32mm", "3/4"
  stockUnit?: string       // unit label e.g. "pcs", "box", "pkt", "roll"
  sellingPrice: number
  costPrice: number
  categoryId: string
  imageUrl?: string
  initialStock?: number
  category?: ProductCategory
}

export type TransactionType = 'SALE' | 'STOCK_IN' | 'ADJUSTMENT'

export type InventoryTransaction = {
  id: string
  type: TransactionType
  productId: string
  quantity: number
  orderId?: string
  createdAt: string       // ISO 8601
  product?: Product       // optional join, populated by API responses
}
