import 'dotenv/config'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/server/db'
import { validateAndBuildSale, createSaleRecord } from '../lib/server/sales'
import { logAudit } from '../lib/server/audit'

/**
 * Records a sale that happened on a previous day, straight into Postgres —
 * no POS UI involved. Reuses the same validation/write path the POS API
 * uses so Sale + InventoryTransaction rows stay paired and price-floor
 * rules still apply.
 *
 * Usage: npx tsx scripts/record-past-sale.ts path/to/sale.json
 *
 * sale.json shape:
 * {
 *   "branchCode": "MAIN",
 *   "cashierName": "Jane Doe",
 *   "createdAt": "2026-06-28T14:30:00",
 *   "saleDiscountAmount": 0,
 *   "lines": [
 *     { "sku": "ABC123", "quantity": 2 },
 *     { "sku": "XYZ789", "quantity": 1, "unitPrice": 450 }
 *   ]
 * }
 */

type SaleFileLine = {
  sku: string
  quantity: number
  unitPrice?: number
}

type SaleFile = {
  branchCode: string
  cashierName: string
  createdAt: string
  saleDiscountAmount?: number
  lines: SaleFileLine[]
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.error('Usage: npx tsx scripts/record-past-sale.ts path/to/sale.json')
    process.exit(1)
  }

  const input = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SaleFile

  if (!input.branchCode || !input.cashierName || !input.createdAt || !input.lines?.length) {
    throw new Error('branchCode, cashierName, createdAt, and lines are required')
  }

  const branch = await prisma.branch.findFirst({ where: { code: input.branchCode } })
  if (!branch) throw new Error(`Unknown branch code: ${input.branchCode}`)

  const cashier = await prisma.user.findFirst({
    where: { name: input.cashierName, branchId: branch.id },
  })
  if (!cashier) throw new Error(`Unknown cashier "${input.cashierName}" at branch ${input.branchCode}`)

  const createdAt = new Date(input.createdAt)
  if (isNaN(createdAt.getTime())) throw new Error(`Invalid createdAt: ${input.createdAt}`)
  if (createdAt.getTime() > Date.now()) throw new Error('createdAt must be in the past')

  const lines = []
  for (const line of input.lines) {
    const product = await prisma.product.findUnique({ where: { sku: line.sku } })
    if (!product) throw new Error(`Unknown SKU: ${line.sku}`)
    lines.push({
      productId: product.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice ?? Number(product.sellingPrice),
      originalUnitPrice: Number(product.sellingPrice),
    })
  }

  const built = await validateAndBuildSale(
    {
      id: randomUUID(),
      branchId: branch.id,
      deviceId: 'manual-backfill',
      lines,
      saleDiscountAmount: input.saleDiscountAmount ?? 0,
      createdAt: createdAt.toISOString(),
    },
    cashier.id,
    branch.organizationId,
  )

  const { sale } = await createSaleRecord(built)

  await logAudit({
    organizationId: branch.organizationId,
    actorId: cashier.id,
    actorName: cashier.name,
    action: 'SALE_CREATE',
    branchId: branch.id,
    targetType: 'Sale',
    targetId: sale.id,
    deviceId: 'manual-backfill',
    metadata: { total: built.total, lines: built.lines.length, backfilled: true },
  })

  console.log(`Recorded sale ${sale.id} for ${input.cashierName} at ${input.branchCode} on ${createdAt.toISOString()}, total KES ${built.total}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
