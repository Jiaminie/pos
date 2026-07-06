/**
 * Read-only diagnostic for the "clean-slate stock for new branches" cutover
 * (docs/plans/rimpa-branch-stock-detach.md). Reports the two baselines that made
 * a borrowing branch (e.g. Rimpa) inherit HQ's stock, so they can be confirmed
 * and quantified before any write:
 *
 *   1. Opening stock — products whose `quantity` parses to a non-zero
 *      initialStock. This baseline is client-side and branch-blind; the fix
 *      scopes it to the origin (primary) branch in lib/db/seed.ts.
 *   2. Legacy null-branch InventoryTransactions — counted toward every branch
 *      until re-attributed to the origin branch (scripts/reattribute-legacy-stock.ts).
 *
 * Also lists every branch with its isPrimary flag so you can confirm the origin
 * branch (HQ) is primary and the borrowing branch is not. Modifies nothing.
 *
 * Run: npx tsx scripts/audit-branch-baseline.ts
 */
import 'dotenv/config'
import { prisma } from '../lib/server/db'

/** Mirror of parseInitialStock in lib/db/seed.ts: sum the digit runs in the
 *  free-text quantity ("1573" -> 1573, "2 boxes of 10" -> 12). */
function parseInitialStock(qty: string | null | undefined): number {
  if (!qty) return 0
  const nums = qty.match(/\d+/g)
  return nums ? nums.reduce((s, n) => s + parseInt(n, 10), 0) : 0
}

async function main() {
  const branches = await prisma.branch.findMany({
    where: { archived: false },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, code: true, isPrimary: true, organizationId: true },
  })

  console.log(`Branches (${branches.length}):`)
  for (const b of branches) {
    console.log(
      `  ${b.isPrimary ? '★ PRIMARY' : '  branch '}  ${b.name} (code=${b.code})  id=${b.id}  org=${b.organizationId}`,
    )
  }
  const primaries = branches.filter((b) => b.isPrimary)
  if (primaries.length !== 1) {
    console.log(
      `\n⚠  Expected exactly one primary branch, found ${primaries.length}. ` +
        `The origin branch that owns opening stock must be unambiguous before cutover.`,
    )
  }

  const nullByType = await prisma.inventoryTransaction.groupBy({
    by: ['type'],
    where: { branchId: null },
    _count: { _all: true },
  })
  const nullTotal = nullByType.reduce((s, r) => s + r._count._all, 0)
  console.log(`\nLegacy transactions with branchId = null: ${nullTotal}`)
  for (const r of nullByType) console.log(`  ${r.type}: ${r._count._all}`)

  const products = await prisma.product.findMany({ select: { quantity: true } })
  const withOpening = products.filter((p) => parseInitialStock(p.quantity) > 0)
  console.log(
    `\nProducts with non-zero opening stock (quantity): ${withOpening.length} of ${products.length}`,
  )

  console.log(
    `\nAfter cutover, every non-primary branch should compute 0 stock for any product ` +
      `it has no branch-scoped transactions for.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
