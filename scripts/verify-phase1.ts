/**
 * Phase 1 verification — stock computation correctness (client + COB server vocabulary).
 * Run: npm run verify:phase1
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyClientStockDelta, buildStockByProductId, computeStock } from '../lib/stock'
import {
  applyServerStockDelta,
  buildStockByProductFromGroupBy,
} from '../lib/server/stockAccumulation'
import type { InventoryTransaction, Product } from '../lib/types'

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

const tx = (
  id: string,
  productId: string,
  type: InventoryTransaction['type'],
  quantity: number,
): InventoryTransaction => ({
  id,
  productId,
  type,
  quantity,
  createdAt: new Date().toISOString(),
})

function verifyClientStockMath() {
  console.log('\n1. lib/stock.ts — ADJUSTMENT signed delta')
  const products = [product('p1', 'Widget', 10)]
  const transactions = [
    tx('1', 'p1', 'SALE', 2),
    tx('2', 'p1', 'STOCK_IN', 5),
    tx('3', 'p1', 'ADJUSTMENT', -3),
    tx('4', 'p1', 'ADJUSTMENT', 4),
    tx('5', 'p1', 'TRANSFER_OUT', 1),
  ]
  const stock = buildStockByProductId(products, transactions)
  assert('negative ADJUSTMENT decreases stock', buildStockByProductId(products, [tx('a', 'p1', 'ADJUSTMENT', -2)]).p1 === 8)
  assert('positive ADJUSTMENT increases stock', buildStockByProductId(products, [tx('b', 'p1', 'ADJUSTMENT', 2)]).p1 === 12)
  assert('mixed chain computes correctly', stock.p1 === 13, `expected 13 got ${stock.p1}`)
  assert('computeStock matches buildStockByProductId', computeStock('p1', transactions, 10) === 13)
  assert('SALE still subtracts', buildStockByProductId(products, [tx('c', 'p1', 'SALE', 3)]).p1 === 7)
  assert('STOCK_IN still adds', buildStockByProductId(products, [tx('d', 'p1', 'STOCK_IN', 3)]).p1 === 13)
  assert('TRANSFER_OUT still subtracts', buildStockByProductId(products, [tx('e', 'p1', 'TRANSFER_OUT', 2)]).p1 === 8)
  assert('applyClientStockDelta matches ADJUSTMENT branch', applyClientStockDelta(10, 'ADJUSTMENT', -2) === 8)
}

function verifyServerStockMath() {
  console.log('\n1b. daily-report server vocabulary (shared stockAccumulation)')
  const rows = [
    { productId: 'p1', type: 'PURCHASE', quantity: 10 },
    { productId: 'p1', type: 'SALE', quantity: 3 },
    { productId: 'p1', type: 'ADJUSTMENT', quantity: -2 },
    { productId: 'p1', type: 'TRANSFER_OUT', quantity: 1 },
    { productId: 'p1', type: 'RETURN', quantity: 1 },
  ]
  const stockByProduct = buildStockByProductFromGroupBy(rows)
  assert('COB netStock handles ADJUSTMENT as signed add', stockByProduct.get('p1') === 5, `got ${stockByProduct.get('p1')}`)
  assert('TRANSFER_OUT subtracts in server vocabulary', applyServerStockDelta(10, 'TRANSFER_OUT', 2) === 8)
  assert('PURCHASE adds in server vocabulary', applyServerStockDelta(10, 'PURCHASE', 3) === 13)
  assert('unknown server type is ignored', applyServerStockDelta(10, 'UNKNOWN', 99) === 10)
}

function verifyStaticWiring() {
  console.log('\n1c. Phase 1 wiring (no duplicated inline loops)')
  const root = join(__dirname, '..')
  const dailyReport = readFileSync(join(root, 'app/api/cron/daily-report/route.ts'), 'utf8')
  const stockTs = readFileSync(join(root, 'lib/stock.ts'), 'utf8')

  assert('daily-report imports shared stockAccumulation', dailyReport.includes('stockAccumulation'))
  assert('daily-report does not inline ADJUSTMENT branch loop', !dailyReport.includes("row.type === 'ADJUSTMENT'"))
  assert('lib/stock.ts uses applyClientStockDelta helper', stockTs.includes('applyClientStockDelta'))
}

function main() {
  console.log('Stock Count — Phase 1 verification\n')
  verifyClientStockMath()
  verifyServerStockMath()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
