export type ProductCategory = {
  id: string
  name: string
}

export type Unit = {
  id: string
  code: string
  name: string
  isCustom: boolean
}

export type Organization = {
  id: string
  name: string
  country: string
}

export type Branch = {
  id: string
  organizationId: string
  name: string
  code: string
  isPrimary: boolean
  address?: string
}

export type TransferStatus = 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'REJECTED' | 'REVERSED'

export type StockTransfer = {
  id: string
  fromBranchId: string
  toBranchId: string
  productId: string
  quantity: number
  status: TransferStatus
  note?: string
  fromDeviceId: string
  toDeviceId?: string
  createdAt: string
  receivedAt?: string
}

export type Product = {
  id: string
  name: string
  sku: string
  barcode?: string
  specification?: string
  /** @deprecated Use unitId instead. Kept for backward compat during migration. */
  stockUnit?: string
  unitId?: string
  sellingPrice: number
  costPrice: number
  lowestPrice?: number
  categoryId: string
  brand: string
  imageUrl?: string
  initialStock?: number
  createdAt?: string
  organizationId?: string
  category?: ProductCategory
  unit?: Unit
}

export type TransactionType = 'SALE' | 'STOCK_IN' | 'ADJUSTMENT' | 'TRANSFER_OUT'

export type TransactionSource = 'SUPPLIER' | 'INTERBRANCH' | 'CORRECTION'

export type SaleLine = {
  id: string
  productId: string
  quantity: number
  unitPrice: number
  originalUnitPrice: number
  lineDiscountAmount: number
}

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER'

export type TeamUser = {
  id: string
  name: string
  role: Role
  branchId: string | null
  active: boolean
  branch?: { id: string; name: string; code: string } | null
}

export type InventoryTransaction = {
  id: string
  type: TransactionType
  productId: string
  quantity: number
  unitPrice?: number
  orderId?: string
  saleId?: string
  originalUnitPrice?: number
  lineDiscountAmount?: number
  source?: TransactionSource | null
  sourceBranchId?: string | null
  branchId?: string
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
