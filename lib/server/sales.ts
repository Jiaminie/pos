import { prisma } from '@/lib/server/db'
import {
  clampUnitPrice,
  discountPerUnit,
  effectiveLowestPrice,
} from '@/lib/pricing'

export type SaleLineInput = {
  id?: string
  productId: string
  quantity: number
  unitPrice: number
  originalUnitPrice?: number
  lineDiscountAmount?: number
}

export type SaleInput = {
  id: string
  branchId: string
  deviceId: string
  lines: SaleLineInput[]
  saleDiscountAmount?: number
  createdAt?: string
}

export async function validateAndBuildSale(
  input: SaleInput,
  cashierId: string,
  organizationId: string,
) {
  const settings = await prisma.storeSettings.findFirst({
    where: { organizationId },
  })
  const minMarkup = Number(settings?.minMarkupPercent ?? 150)

  const productIds = input.lines.map((l) => l.productId)
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  })
  const productMap = Object.fromEntries(products.map((p) => [p.id, p]))

  let subtotal = 0
  let lineDiscountTotal = 0
  const validatedLines: Array<{
    id: string
    productId: string
    quantity: number
    unitPrice: number
    originalUnitPrice: number
    lineDiscountAmount: number
  }> = []

  for (const line of input.lines) {
    const product = productMap[line.productId]
    if (!product) throw new Error(`Unknown product: ${line.productId}`)

    const sell = Number(product.sellingPrice)
    const cost = Number(product.costPrice)
    const lowest = product.lowestPrice != null ? Number(product.lowestPrice) : null

    const floor = effectiveLowestPrice(
      { sellingPrice: sell, costPrice: cost, lowestPrice: lowest },
      minMarkup,
    )
    const clamped = clampUnitPrice(
      { sellingPrice: sell, costPrice: cost, lowestPrice: lowest },
      line.unitPrice,
      minMarkup,
    )

    if (clamped < floor - 0.001) {
      throw new Error(`Price below floor for ${product.name}`)
    }

    const original = line.originalUnitPrice ?? sell
    const lineDisc = line.lineDiscountAmount ?? discountPerUnit(original, clamped) * line.quantity

    subtotal += original * line.quantity
    lineDiscountTotal += lineDisc

    validatedLines.push({
      id: line.id ?? crypto.randomUUID(),
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: clamped,
      originalUnitPrice: original,
      lineDiscountAmount: lineDisc,
    })
  }

  const saleDiscountAmount = input.saleDiscountAmount ?? 0
  const total =
    validatedLines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) -
    saleDiscountAmount

  if (total < 0) throw new Error('Sale total cannot be negative')

  return {
    subtotal,
    lineDiscountTotal,
    saleDiscountAmount,
    total,
    lines: validatedLines,
    cashierId,
    organizationId,
    branchId: input.branchId,
    deviceId: input.deviceId,
    id: input.id,
    createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
  }
}

export async function createSaleRecord(
  built: Awaited<ReturnType<typeof validateAndBuildSale>>,
) {
  return prisma.$transaction(async (tx) => {
    // Detect first-write vs an offline re-sync retry, so callers only
    // audit/alert once per sale rather than on every idempotent replay.
    const existing = await tx.sale.findUnique({
      where: { id: built.id },
      select: { id: true },
    })

    const sale = await tx.sale.upsert({
      where: { id: built.id },
      update: { syncedAt: new Date() },
      create: {
        id: built.id,
        organizationId: built.organizationId,
        branchId: built.branchId,
        deviceId: built.deviceId,
        cashierId: built.cashierId,
        subtotal: built.subtotal,
        lineDiscountTotal: built.lineDiscountTotal,
        saleDiscountAmount: built.saleDiscountAmount,
        total: built.total,
        createdAt: built.createdAt,
        syncedAt: new Date(),
      },
    })

    for (const line of built.lines) {
      await tx.inventoryTransaction.upsert({
        where: { id: line.id },
        update: { syncedAt: new Date() },
        create: {
          id: line.id,
          productId: line.productId,
          type: 'SALE',
          branchId: built.branchId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          originalUnitPrice: line.originalUnitPrice,
          lineDiscountAmount: line.lineDiscountAmount,
          saleId: sale.id,
          deviceId: built.deviceId,
          createdAt: built.createdAt,
          syncedAt: new Date(),
        },
      })
    }

    return { sale, created: !existing }
  })
}
