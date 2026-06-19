export type ProductCategory = {
  id: string
  name: string
}

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
  specification?: string
  stockUnit?: string
  sellingPrice: number
  costPrice: number
  lowestPrice?: number
  categoryId: string
  brand: string
  imageUrl?: string
  initialStock?: number
  createdAt?: string
  category?: ProductCategory
}

export type TransactionType = 'SALE' | 'STOCK_IN' | 'ADJUSTMENT'

export type InventoryTransaction = {
  id: string
  type: TransactionType
  productId: string
  quantity: number
  unitPrice?: number
  orderId?: string
  createdAt: string
  product?: Product
}

export type IncidentReason = 'OUT_OF_STOCK' | 'PRICE_TOO_HIGH' | 'NOT_AVAILABLE' | 'OTHER'

export const INCIDENT_REASON_LABELS: Record<IncidentReason, string> = {
  OUT_OF_STOCK:  'Out of stock',
  PRICE_TOO_HIGH:'Price too high',
  NOT_AVAILABLE: 'Not available',
  OTHER:         'Other',
}

export type Incident = {
  id: string
  productId?: string
  productName: string
  reason: IncidentReason
  note?: string
  deviceId: string
  createdAt: string
}
