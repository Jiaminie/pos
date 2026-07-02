/**
 * One-off diagnostic: the ADJUSTMENT sign-flip fix (lib/stock.ts,
 * lib/server/stockAccumulation.ts) changed how quantity is interpreted for
 * type: 'ADJUSTMENT' transactions from "always subtract" to "signed delta".
 *
 * The stock.count.adjust permission and the ADJUSTMENT/CORRECTION type were
 * already accepted by POST /api/transactions before the stock-count feature
 * shipped, so any ADJUSTMENT row created before this change was stored under
 * the OLD (always-subtract) convention. This script cannot know the intent
 * behind an existing row, so it only reports — it does not modify anything.
 *
 * Run: npx tsx scripts/check-legacy-adjustments.ts
 */
import { prisma } from '../lib/server/db'

async function main() {
  const rows = await prisma.inventoryTransaction.findMany({
    where: { type: 'ADJUSTMENT' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productId: true,
      product: { select: { name: true } },
      quantity: true,
      branchId: true,
      createdAt: true,
      source: true,
    },
  })

  if (rows.length === 0) {
    console.log('No ADJUSTMENT transactions found — nothing to review.')
    return
  }

  console.log(
    `Found ${rows.length} ADJUSTMENT transaction(s). Each was stored before this fix ` +
      `shipped, so its stored quantity may have been intended under the OLD (always-subtract) ` +
      `convention rather than the new signed-delta one. Review each against what actually ` +
      `happened at that branch/time before trusting current stock figures for these products:\n`,
  )

  for (const row of rows) {
    console.log(
      `  ${row.createdAt.toISOString()}  product=${row.product?.name ?? row.productId}  ` +
        `qty=${row.quantity}  source=${row.source ?? '—'}  branch=${row.branchId ?? '—'}  id=${row.id}`,
    )
  }

  console.log(
    '\nIf any of these predate this feature and their sign looks wrong, correct them manually ' +
      '(e.g. a new offsetting ADJUSTMENT) — do not bulk-flip signs without confirming intent per row.',
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
