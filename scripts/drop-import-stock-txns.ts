import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Historic bulk imports recorded opening stock TWICE: in product.quantity AND
// as a PURCHASE inventory transaction tagged with deviceId 'bulk-import'. Now
// that every device replicates the transaction log to compute stock, those
// rows double-count against the quantity baseline. Opening stock lives only in
// product.quantity, so these transactions are safe to delete.
//
// Dry-run by default. Re-run with `--apply` to actually delete.
//   npx tsx scripts/drop-import-stock-txns.ts          # preview
//   npx tsx scripts/drop-import-stock-txns.ts --apply  # delete

const BULK_IMPORT_DEVICE_ID = 'bulk-import'

function resolveConnectionString(url: string): string {
  if (url.startsWith('prisma+postgres://')) {
    const apiKey = new URL(url).searchParams.get('api_key')!
    return JSON.parse(Buffer.from(apiKey, 'base64').toString()).databaseUrl
  }
  return url
}

const prisma = new PrismaClient({ adapter: new PrismaPg(resolveConnectionString(process.env.DATABASE_URL!)) })

async function main() {
  const apply = process.argv.includes('--apply')
  const where = { deviceId: BULK_IMPORT_DEVICE_ID }

  const count = await prisma.inventoryTransaction.count({ where })
  const totalTx = await prisma.inventoryTransaction.count()
  console.log(`Bulk-import opening transactions: ${count} of ${totalTx} total`)

  if (count === 0) {
    console.log('Nothing to delete.')
    return
  }

  if (!apply) {
    console.log('\nDRY RUN — no rows deleted. Re-run with --apply to delete them.')
    const sample = await prisma.inventoryTransaction.findMany({
      where,
      take: 5,
      select: { id: true, productId: true, type: true, quantity: true, createdAt: true },
    })
    console.log('Sample rows that would be deleted:')
    sample.forEach((t) =>
      console.log(` - ${t.id} | product ${t.productId} | ${t.type} ${t.quantity} | ${t.createdAt.toISOString()}`),
    )
    return
  }

  const { count: deleted } = await prisma.inventoryTransaction.deleteMany({ where })
  console.log(`Deleted ${deleted} bulk-import opening transactions.`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
