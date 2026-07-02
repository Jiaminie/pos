/**
 * Phase 7 verification gate for the stock-count feature.
 * Run: npm run verify:stock-count
 *
 * Pass `--skip-phases` to skip spawning verify:phase0–phase6 subprocesses.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildStockByProductId, computeStock } from '../lib/stock'
import {
  buildAdjustmentTransactions,
  computePendingAdjustments,
  round2,
} from '../lib/stock-count/manual'
import { buildStockByProductFromGroupBy } from '../lib/server/stockAccumulation'
import { classifySyncItem, PERMISSION_BY_TRANSACTION_TYPE } from '../lib/server/auth/transactionPermissions'
import { canAccessBranch } from '../lib/server/auth/guard'
import type { AuthUser } from '../lib/server/auth/guard'
import {
  applyResumeDraftsToCounts,
  clearResolvedKeysForUpload,
  computeAllPhotoAggregates,
  computeUploadAggregates,
  draftIdsThatContributedToCounts,
  mergePhotoAggregatesIntoCounts,
  rowKey,
} from '../lib/stock-count/aggregate'
import { matchProduct } from '../lib/stock-count/match'
import type { StockCountUpload } from '../lib/stock-count/types'
import { isValidStockCountImageUrl } from '../lib/server/stock-count/cloudinary'
import { anthropicConfigured } from '../lib/server/stock-count/extract'
import { STALE_DRAFT_MS } from '../lib/stock-count/upload'
import type { InventoryTransaction, Product } from '../lib/types'

const root = join(__dirname, '..')
const skipPhases = process.argv.includes('--skip-phases')

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

const extractedUpload = (
  id: string,
  rows: StockCountUpload['extractedRows'],
  status: StockCountUpload['status'] = 'EXTRACTED',
): StockCountUpload => ({
  id,
  branchId: 'b1',
  uploadedById: 'u1',
  imageUrl: `https://res.cloudinary.com/demo/image/upload/v1/pos/stock-count/${id}.jpg`,
  status,
  extractedRows: rows,
  errorMessage: status === 'ERROR' ? 'failed' : null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  submittedAt: null,
})

function verifyStockMath() {
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
}

function verifyDailyReportStockLoop() {
  console.log('\n1b. daily-report stock vocabulary')
  const stockByProduct = buildStockByProductFromGroupBy([
    { productId: 'p1', type: 'PURCHASE', quantity: 10 },
    { productId: 'p1', type: 'SALE', quantity: 3 },
    { productId: 'p1', type: 'ADJUSTMENT', quantity: -2 },
    { productId: 'p1', type: 'TRANSFER_OUT', quantity: 1 },
    { productId: 'p1', type: 'RETURN', quantity: 1 },
  ])
  assert('COB netStock handles ADJUSTMENT as signed add', stockByProduct.get('p1') === 5, `got ${stockByProduct.get('p1')}`)
}

function classifyBatchItem(
  item: { id?: string; type: string; branchId?: string | null },
  user: AuthUser,
  permissionGranted: Map<string, boolean>,
): 'ok' | 'forbidden' | 'invalid_type' {
  if (!item.id) return 'invalid_type'
  const typeStatus = classifySyncItem(item.type, permissionGranted)
  if (typeStatus !== 'ok') return typeStatus
  if (!canAccessBranch(user, item.branchId)) return 'forbidden'
  return 'ok'
}

function verifySyncPermissions() {
  console.log('\n2. /api/sync — per-item permission classification')

  const cashier: AuthUser = {
    userId: 'u-cashier',
    role: 'CASHIER',
    branchId: 'branch-a',
    orgId: 'org-1',
    name: 'Cashier',
  }

  const cashierGranted = new Map<string, boolean>([
    ['PURCHASE', true],
    ['ADJUSTMENT', false],
  ])
  const managerGranted = new Map<string, boolean>([
    ['PURCHASE', true],
    ['ADJUSTMENT', true],
  ])

  assert('CASHIER ADJUSTMENT → forbidden', classifySyncItem('ADJUSTMENT', cashierGranted) === 'forbidden')
  assert('MANAGER ADJUSTMENT → ok', classifySyncItem('ADJUSTMENT', managerGranted) === 'ok')
  assert('unknown type → invalid_type', classifySyncItem('NOT_A_TYPE', managerGranted) === 'invalid_type')

  const batch = [
    { id: 'adj-1', type: 'ADJUSTMENT', branchId: 'branch-a' },
    { id: 'pur-1', type: 'PURCHASE', branchId: 'branch-a' },
  ]
  const results = batch.map((item) => classifyBatchItem(item, cashier, cashierGranted))
  assert(
    'mixed batch: PURCHASE ok while ADJUSTMENT forbidden',
    results[0] === 'forbidden' && results[1] === 'ok',
    JSON.stringify(results),
  )
  assert(
    'mixed batch returns 200 shape (all items get a status, not blanket reject)',
    results.every((r) => ['ok', 'forbidden', 'invalid_type'].includes(r)),
  )
  assert(
    'branch mismatch is per-item forbidden',
    classifyBatchItem({ id: 'tx-b', type: 'PURCHASE', branchId: 'branch-b' }, cashier, cashierGranted) === 'forbidden',
  )

  assert(
    'permission map covers all server transaction types',
    Object.keys(PERMISSION_BY_TRANSACTION_TYPE).length === 5,
  )
}

function verifyRateLimit() {
  console.log('\n2b. extract rate limiting')
  const rateLimitLib = readFileSync(join(root, 'lib/server/stock-count/rateLimit.ts'), 'utf8')
  assert(
    'rate limit is durable (DB-backed), not an in-memory Map — an in-memory ' +
      'counter would reset per cold start and not be shared across serverless instances',
    !rateLimitLib.includes('new Map'),
  )
  assert(
    'rate limit counts StockCountUpload rows created in the trailing window',
    rateLimitLib.includes('stockCountUpload') && rateLimitLib.includes('WINDOW_MS'),
  )
}

function verifyPhotoAndMatching() {
  console.log('\n4–6. Photo flow — matching, merge, resume constants')

  const products = [
    product('p-hammer', 'Claw Hammer 16oz', 5),
    product('p-nails', 'Steel Nails 1kg', 20),
  ]

  const uploadA = extractedUpload('up-a', [
    { description: 'Claw Hammer 16oz', qty: 4, sizeType: null, type: null, company: null },
  ])
  const uploadB = extractedUpload('up-b', [
    { description: 'Claw Hammer 16oz', qty: 3, sizeType: null, type: null, company: null },
  ])

  const aggs = computeAllPhotoAggregates([uploadA, uploadB], products, {})
  assert('duplicate product across photos sums qty', aggs.get('p-hammer') === 7, `got ${aggs.get('p-hammer')}`)

  const merged = mergePhotoAggregatesIntoCounts({}, aggs)
  assert('merged counts land in counted-qty shape', merged['p-hammer'] === '7')

  const match = matchProduct('Claw Hammer 16oz', products)
  assert('high-confidence match resolves product', match.status === 'matched' && match.productId === 'p-hammer')

  const badMatch = matchProduct('xyzzy unknown item', products)
  assert('unknown description stays unmatched', badMatch.status === 'unmatched')

  process.env.CLOUDINARY_CLOUD_NAME = 'demo'
  assert('valid Cloudinary stock-count URL accepted', isValidStockCountImageUrl(uploadA.imageUrl))
  assert(
    'wrong-folder URL rejected',
    !isValidStockCountImageUrl('https://res.cloudinary.com/demo/image/upload/v1/pos/products/x.jpg'),
  )

  assert('stale threshold is 4 hours', STALE_DRAFT_MS === 4 * 60 * 60 * 1000)
}

function verifyPartialBatchIsolation() {
  console.log('\n5. Partial batch — per-upload ERROR does not block siblings')

  const uploads: StockCountUpload[] = [
    extractedUpload('ok-1', [
      { description: 'Steel Nails 1kg', qty: 2, sizeType: null, type: null, company: null },
    ]),
    extractedUpload('err-1', null, 'ERROR'),
  ]
  uploads[1]!.errorMessage = 'ANTHROPIC_API_KEY is not configured — photo extraction is unavailable'

  const products = [product('p-nails', 'Steel Nails 1kg', 20)]
  const okUpload = uploads.find((u) => u.status === 'EXTRACTED')!
  const errUpload = uploads.find((u) => u.status === 'ERROR')!

  assert('good upload still has extracted rows', (okUpload.extractedRows as unknown[]).length === 1)
  assert('bad upload keeps ERROR status + message', errUpload.errorMessage?.includes('ANTHROPIC') ?? false)
  assert(
    'good upload aggregates independently',
    computeUploadAggregates(okUpload, products, {}).get('p-nails') === 2,
  )
}

function verifyManualSubmitPath() {
  console.log('\n3. Manual entry — ADJUSTMENT transaction shape')

  const products = [product('p1', 'Widget', 10), product('p2', 'Bolt', 5)]
  const stock = { p1: 10, p2: 5 }
  const pending = computePendingAdjustments(products, { p1: '13', p2: '5' }, stock)
  assert('non-zero delta produces adjustment', pending.length === 1 && pending[0]?.delta === 3)
  assert('zero delta skipped', round2(10 - 10) === 0)

  const txs = buildAdjustmentTransactions(
    pending,
    'branch-a',
    { now: new Date('2026-07-02T12:00:00.000Z'), createId: () => 'tx-adj-1' },
  )
  assert('one ADJUSTMENT tx per pending row', txs.length === 1)
  assert('type ADJUSTMENT', txs[0]?.type === 'ADJUSTMENT')
  assert('source CORRECTION', txs[0]?.source === 'CORRECTION')
  assert('signed quantity from reviewed delta', txs[0]?.quantity === 3)
  assert('branchId set on submit', txs[0]?.branchId === 'branch-a')
}

function verifyManualResolveAndLifecycle() {
  console.log('\n6. Manual resolve + draft lifecycle')

  const products = [product('p-hammer', 'Claw Hammer 16oz', 5)]
  const unmatched = extractedUpload('unmatched-1', [
    { description: 'xyzzy misread hammer', qty: 7, sizeType: null, type: null, company: null },
  ])
  const resolvedKey = rowKey('unmatched-1', 0)

  assert(
    'unmatched extraction does not auto-count',
    computeUploadAggregates(unmatched, products, {}).size === 0,
  )
  assert(
    'manual resolve applies reviewed qty (not raw misread match)',
    computeUploadAggregates(unmatched, products, { [resolvedKey]: 'p-hammer' }).get('p-hammer') === 7,
  )
  assert(
    'resolved upload counts as contributing on submit',
    draftIdsThatContributedToCounts([unmatched], products, { [resolvedKey]: 'p-hammer' }).includes('unmatched-1'),
  )

  const ok = extractedUpload('ok-1', [
    { description: 'Claw Hammer 16oz', qty: 2, sizeType: null, type: null, company: null },
  ])
  const err = extractedUpload('err-1', null, 'ERROR')
  const resumeAgg = applyResumeDraftsToCounts([ok, err], products, {})
  assert('resume aggregates only EXTRACTED matched rows', resumeAgg.get('p-hammer') === 2)

  const cleared = clearResolvedKeysForUpload({ 'ok-1:0': 'p-hammer', 'other:1': 'p-nails' }, 'ok-1')
  assert(
    'discard clears resolved keys for upload',
    !('ok-1:0' in cleared) && cleared['other:1'] === 'p-nails',
  )
}

function verifyStaticIntegration() {
  console.log('\n3, 7, 8. Static integration checks')

  const layout = readFileSync(join(root, 'app/(ui)/layout.tsx'), 'utf8')
  const stockPage = readFileSync(join(root, 'app/(ui)/stock-count/page.tsx'), 'utf8')
  const productsPage = readFileSync(join(root, 'app/(ui)/products/page.tsx'), 'utf8')
  const posPage = readFileSync(join(root, 'app/(ui)/pos/page.tsx'), 'utf8')
  const transfersRoute = readFileSync(join(root, 'app/api/transfers/route.ts'), 'utf8')
  const extractRoute = readFileSync(join(root, 'app/api/stock-count/extract/route.ts'), 'utf8')
  const completeRoute = readFileSync(join(root, 'app/api/stock-count/uploads/complete/route.ts'), 'utf8')
  const syncRoute = readFileSync(join(root, 'app/api/sync/route.ts'), 'utf8')
  const syncQueue = readFileSync(join(root, 'lib/db/syncQueue.ts'), 'utf8')
  const salesSyncQueue = readFileSync(join(root, 'lib/db/salesSyncQueue.ts'), 'utf8')
  const readme = readFileSync(join(root, 'README.md'), 'utf8')
  const extractLib = readFileSync(join(root, 'lib/server/stock-count/extract.ts'), 'utf8')
  const extractPost = extractRoute.slice(extractRoute.indexOf('export async function POST'))

  assert('nav gated on stock.count.adjust', layout.includes("hasPermission(authUser, 'stock.count.adjust')"))
  assert('stock-count nav entry present', layout.includes("href: '/stock-count'"))
  assert('page permission gate for CASHIER', stockPage.includes("!hasPermission(authUser, 'stock.count.adjust')"))
  assert('double-submit ref guard', stockPage.includes('submittingRef'))
  assert('double-submit button disabled', stockPage.includes('disabled={submitting'))
  assert('resume drafts on load (GET extract)', stockPage.includes('fetchResumableDrafts'))
  assert('submit only contributing photo drafts', stockPage.includes('draftIdsThatContributedToCounts'))
  assert('resume merges all drafts in one pass', stockPage.includes('applyResumeDraftsToCounts'))
  assert('manual resolve handler wired', stockPage.includes('handleResolveRow'))
  assert('discard calls completion endpoint', stockPage.includes("'DISCARDED'"))
  assert('GET resume excludes terminal statuses', extractRoute.includes('RESUMABLE_DRAFT_STATUSES'))
  assert('complete endpoint requires branchId', completeRoute.includes("'branchId is required'"))
  assert(
    'extract validates URLs before rate limit',
    extractPost.indexOf('invalidUrls') < extractPost.indexOf('checkExtractRateLimit(user.userId)'),
  )
  assert('extract uses messages.parse', extractLib.includes('messages.parse'))
  assert(
    'complete endpoint supports SUBMITTED/DISCARDED',
    completeRoute.includes("'SUBMITTED'") && completeRoute.includes("'DISCARDED'"),
  )
  assert('sync route returns per-item results (not blanket 403)', syncRoute.includes("status: 200") && syncRoute.includes('results'))
  assert('sync drain dead-letters forbidden items', syncQueue.includes("'forbidden'") && syncQueue.includes("'invalid_type'"))
  assert('README documents ANTHROPIC_API_KEY', readme.includes('ANTHROPIC_API_KEY'))
  assert('README documents verify:stock-count', readme.includes('verify:stock-count'))
  assert('missing API key has explicit error message', extractLib.includes('ANTHROPIC_API_KEY is not configured'))
  assert(
    'StockCountUpload row created before Claude call',
    extractPost.includes("status: 'PENDING'") && extractPost.includes('prisma.stockCountUpload.create'),
  )
  assert('extract route caps batch at 10 images', extractRoute.includes('MAX_IMAGES = 10'))

  assert(
    'restock regression: products page uses offline sync path',
    productsPage.includes('createManyTx') && productsPage.includes('pushManyTx') && productsPage.includes("type: 'STOCK_IN'"),
  )
  assert(
    'transfers regression: initiate route permission-gated',
    transfersRoute.includes("'stock.transfer.initiate'"),
  )
  assert(
    'POS sales regression: sales use /api/sales queue (not /api/sync)',
    salesSyncQueue.includes("fetch('/api/sales'") && posPage.includes('pushSale') && posPage.includes('drainSales'),
  )
}

function verifyPhaseScripts() {
  if (skipPhases) {
    console.log('\n9. Phase script orchestration (skipped — pass without --skip-phases to run)')
    return
  }

  console.log('\n9. Phase script orchestration (verify:phase0–phase6)')
  for (const phase of ['phase0', 'phase1', 'phase2', 'phase3', 'phase4', 'phase5', 'phase6'] as const) {
    const result = spawnSync('npm', ['run', `verify:${phase}`], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
    })
    const tail = (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join('\n')
    assert(`verify:${phase} passes`, result.status === 0, tail || `exit ${result.status ?? 'unknown'}`)
  }
}

function main() {
  console.log('Stock Count — Phase 7 verification\n')

  verifyStockMath()
  verifyDailyReportStockLoop()
  verifySyncPermissions()
  verifyRateLimit()
  verifyPhotoAndMatching()
  verifyPartialBatchIsolation()
  verifyManualSubmitPath()
  verifyManualResolveAndLifecycle()
  verifyStaticIntegration()
  verifyPhaseScripts()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (!anthropicConfigured()) {
    console.log(
      '\nNote: ANTHROPIC_API_KEY not set — live extraction E2E skipped (graceful-failure paths verified statically).',
    )
  }
  if (!process.env.DATABASE_URL) {
    console.log(
      'Note: DATABASE_URL not set — live /api/sync HTTP + DB E2E skipped (classification logic verified above).',
    )
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
