import 'dotenv/config'
import { prisma } from '../lib/server/db'

/** Read-only helper: dumps branches, users, and products for manual matching. Makes no writes. */
async function main() {
  const branches = await prisma.branch.findMany({ select: { id: true, code: true, name: true } })
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true, branchId: true } })
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, specification: true, sellingPrice: true },
    orderBy: { name: 'asc' },
  })

  console.log('=== BRANCHES ===')
  console.log(JSON.stringify(branches, null, 2))
  console.log('=== USERS ===')
  console.log(JSON.stringify(users, null, 2))
  console.log('=== PRODUCTS ===')
  console.log(JSON.stringify(products, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
