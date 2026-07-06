import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Legacy InventoryTransactions with branchId = null (recorded before the app was
// branch-aware) are summed into EVERY branch's stock, so a borrowing branch like
// Rimpa inherits the origin branch's history. This re-points them to the origin
// (primary) branch, which is a no-op for the origin's own computed stock — it
// already counted those rows via the null-branch fallback — while stopping the
// leak into every other branch. Pairs with the removal of that fallback in
// lib/stock.ts + app/api/transactions/route.ts. See
// docs/plans/rimpa-branch-stock-detach.md.
//
// Dry-run by default. Re-run with `--apply` to write.
//   npx tsx scripts/reattribute-legacy-stock.ts                 # preview
//   npx tsx scripts/reattribute-legacy-stock.ts --hq-code=HQ01  # override origin
//   npx tsx scripts/reattribute-legacy-stock.ts --apply         # write

function resolveConnectionString(url: string): string {
  if (url.startsWith('prisma+postgres://')) {
    const apiKey = new URL(url).searchParams.get('api_key')!
    return JSON.parse(Buffer.from(apiKey, 'base64').toString()).databaseUrl
  }
  return url
}

const prisma = new PrismaClient({ adapter: new PrismaPg(resolveConnectionString(process.env.DATABASE_URL!)) })

function getFlag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg?.split('=')[1]
}

async function main() {
  const apply = process.argv.includes('--apply')
  const hqCode = getFlag('hq-code')

  // Resolve the origin branch: explicit --hq-code wins, else the sole primary.
  const origin = hqCode
    ? await prisma.branch.findFirst({ where: { code: hqCode, archived: false } })
    : await (async () => {
        const primaries = await prisma.branch.findMany({ where: { isPrimary: true, archived: false } })
        if (primaries.length !== 1) {
          throw new Error(
            `Expected exactly one primary branch, found ${primaries.length}. ` +
              `Pass --hq-code=<code> to name the origin branch explicitly.`,
          )
        }
        return primaries[0]
      })()

  if (!origin) {
    throw new Error(hqCode ? `No branch found with code=${hqCode}.` : 'No origin branch resolved.')
  }

  const where = { branchId: null }
  const count = await prisma.inventoryTransaction.count({ where })
  const totalTx = await prisma.inventoryTransaction.count()
  console.log(`Origin (HQ) branch: ${origin.name} (code=${origin.code}) id=${origin.id}`)
  console.log(`Legacy null-branch transactions: ${count} of ${totalTx} total`)

  if (count === 0) {
    console.log('Nothing to re-attribute.')
    return
  }

  if (!apply) {
    console.log('\nDRY RUN — no rows changed. Re-run with --apply to re-attribute them.')
    const sample = await prisma.inventoryTransaction.findMany({
      where,
      take: 5,
      select: { id: true, productId: true, type: true, quantity: true, createdAt: true },
    })
    console.log(`Sample rows that would move to branch ${origin.id}:`)
    sample.forEach((t) =>
      console.log(` - ${t.id} | product ${t.productId} | ${t.type} ${t.quantity} | ${t.createdAt.toISOString()}`),
    )
    return
  }

  const { count: updated } = await prisma.inventoryTransaction.updateMany({
    where,
    data: { branchId: origin.id },
  })
  console.log(`Re-attributed ${updated} legacy transactions to ${origin.name}.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
