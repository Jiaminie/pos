/**
 * Phase 4 verification — manual stock count entry (ADJUSTMENT submit path).
 * Run: npm run verify:phase4
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildAdjustmentTransactions,
  computePendingAdjustments,
  getRowDelta,
  round2,
} from '../lib/stock-count/manual'
import type { Product } from '../lib/types'

let passed = 0
let failed = 0

function ok(name: string) {
  passed++
  console.log(`  ✓ ${name}`)
}

function fail(name: string, detail: string) {
  failed++
  console.error(`  ✗ ${name}: ${detail}`)
}

function assert(name: string, condition: boolean, detail = 'assertion failed') {
  if (condition) ok(name)
  else fail(name, detail)
}

const product = (id: string, name: string, initialStock = 10): Product => ({
  id,
  name,
  sku: `SKU-${id}`,
  sellingPrice: 100,
  costPrice: 50,
  categoryId: 'cat-1',
  brand: 'TEST',
  initialStock,
})

function verifyDeltaMath() {
  console.log('\n4a. Delta rounding and row filtering')
  assert('delta rounded to 2dp', round2(13 - 10) === 3)
  assert('zero delta skipped', round2(10 - 10) === 0)

  const products = [product('p1', 'Widget', 10), product('p2', 'Bolt', 5)]
  const stock = { p1: 10, p2: 5 }
  const pending = computePendingAdjustments(
    products,
    { p1: '13', p2: '5', p3: '99' },
    stock,
  )
  assert('non-zero delta produces adjustment', pending.length === 1 && pending[0]?.delta === 3)
  assert('empty counted skipped', computePendingAdjustments(products, { p1: '   ' }, stock).length === 0)
  assert('NaN counted skipped', computePendingAdjustments(products, { p1: 'abc' }, stock).length === 0)
  assert('getRowDelta null when no input', getRowDelta('p1', {}, stock) === null)
  assert('getRowDelta matches pending delta', getRowDelta('p1', { p1: '8' }, stock) === -2)
}

function verifyTransactionShape() {
  console.log('\n4b. ADJUSTMENT transaction shape')

  const txs = buildAdjustmentTransactions(
    [{ productId: 'p1', delta: -2.5 }],
    'branch-a',
    { now: new Date('2026-07-02T12:00:00.000Z'), createId: () => 'tx-1' },
  )

  assert('one tx per adjustment', txs.length === 1)
  const tx = txs[0]!
  assert('type ADJUSTMENT', tx.type === 'ADJUSTMENT')
  assert('source CORRECTION', tx.source === 'CORRECTION')
  assert('signed quantity preserved', tx.quantity === -2.5)
  assert('branchId set', tx.branchId === 'branch-a')
  assert('stable id from factory', tx.id === 'tx-1')
}

function verifyStaticWiring() {
  console.log('\n4c. Phase 4 wiring')

  const root = join(__dirname, '..')
  const page = readFileSync(join(root, 'app/(ui)/stock-count/page.tsx'), 'utf8')
  const layout = readFileSync(join(root, 'app/(ui)/layout.tsx'), 'utf8')

  assert('page uses shared manual helpers', page.includes('stock-count/manual'))
  assert('submit builds ADJUSTMENT txs', page.includes('buildAdjustmentTransactions'))
  assert(
    'offline sync: createMany → pushMany → drain',
    page.includes('createManyTx') && page.includes('pushManyTx') && page.includes('drain()'),
  )
  assert('branch-scoped stock', page.includes('buildStockByProductId'))
  assert('double-submit ref guard', page.includes('submittingRef'))
  assert(
    'permission gate on page',
    page.includes('hasPermission') && page.includes("'stock.count.adjust'"),
  )
  assert('nav gated on stock.count.adjust', layout.includes("hasPermission(authUser, 'stock.count.adjust')"))
  assert('stock-count nav entry present', layout.includes("href: '/stock-count'"))
  assert('submit button disabled while submitting', page.includes('disabled={submitting'))
}

function main() {
  console.log('Stock Count — Phase 4 verification\n')
  verifyDeltaMath()
  verifyTransactionShape()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
