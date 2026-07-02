/**
 * Phase 6 verification — photo-assisted entry frontend wiring.
 * Run: npm run verify:phase6
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyResumeDraftsToCounts,
  clearResolvedKeysForUpload,
  computeAllPhotoAggregates,
  draftIdsThatContributedToCounts,
  mergePhotoAggregatesIntoCounts,
  rowKey,
} from '../lib/stock-count/aggregate'
import { matchProduct } from '../lib/stock-count/match'
import type { StockCountUpload } from '../lib/stock-count/types'
import {
  MAX_PHOTOS_PER_BATCH,
  MAX_PHOTO_BYTES,
  STALE_DRAFT_MS,
  validatePhotoFiles,
} from '../lib/stock-count/upload'
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

const product = (id: string, name: string): Product => ({
  id,
  name,
  sku: `SKU-${id}`,
  sellingPrice: 100,
  costPrice: 50,
  categoryId: 'cat-1',
  brand: 'TEST',
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

function verifyMatchingAndMerge() {
  console.log('\n6a. Product matching and cross-photo merge')

  const products = [product('p-hammer', 'Claw Hammer 16oz'), product('p-nails', 'Steel Nails 1kg')]
  const uploadA = extractedUpload('a', [
    { description: 'Claw Hammer 16oz', qty: 4, sizeType: null, type: null, company: null },
  ])
  const uploadB = extractedUpload('b', [
    { description: 'Claw Hammer 16oz', qty: 3, sizeType: null, type: null, company: null },
  ])

  assert(
    'duplicate product across photos sums qty',
    computeAllPhotoAggregates([uploadA, uploadB], products, {}).get('p-hammer') === 7,
  )
  assert(
    'merged counts land in counted-qty shape',
    mergePhotoAggregatesIntoCounts({}, computeAllPhotoAggregates([uploadA], products, {}))['p-hammer'] === '4',
  )

  const match = matchProduct('Claw Hammer 16oz', products)
  assert('high-confidence match resolves product', match.status === 'matched' && match.productId === 'p-hammer')
  assert('unknown description stays unmatched', matchProduct('xyzzy unknown', products).status === 'unmatched')
}

function verifyResumeAndSubmitLifecycle() {
  console.log('\n6b. Resume and submit lifecycle helpers')

  const products = [product('p-hammer', 'Claw Hammer 16oz')]
  const ok = extractedUpload('ok', [
    { description: 'Claw Hammer 16oz', qty: 2, sizeType: null, type: null, company: null },
  ])
  const err = extractedUpload('err', null, 'ERROR')
  const unused = extractedUpload('unused', [
    { description: 'totally unknown sku xyz', qty: 1, sizeType: null, type: null, company: null },
  ])

  const resumeAgg = applyResumeDraftsToCounts([ok, err, unused], products, {})
  assert('resume aggregates only EXTRACTED matched rows', resumeAgg.get('p-hammer') === 2)

  const contributing = draftIdsThatContributedToCounts([ok, err, unused], products, {})
  assert('only contributing uploads marked for submit', contributing.length === 1 && contributing[0] === 'ok')

  const resolvedKey = rowKey('unused', 0)
  const withResolved = draftIdsThatContributedToCounts([unused], products, {
    [resolvedKey]: 'p-hammer',
  })
  assert('manually resolved row counts as contributing', withResolved.includes('unused'))

  const cleared = clearResolvedKeysForUpload({ 'ok:0': 'p-hammer', 'other:1': 'p-nails' }, 'ok')
  assert(
    'discard clears resolved keys for upload',
    !('ok:0' in cleared) && cleared['other:1'] === 'p-nails',
  )
}

function verifyClientValidation() {
  console.log('\n6c. Client-side photo validation constants')
  assert('max 10 photos per batch', MAX_PHOTOS_PER_BATCH === 10)
  assert('max 5 MB per photo', MAX_PHOTO_BYTES === 5 * 1024 * 1024)
  assert('stale threshold is 4 hours', STALE_DRAFT_MS === 4 * 60 * 60 * 1000)

  const tooMany = Array.from({ length: 11 }, (_, i) => ({ type: 'image/jpeg', size: 1000, name: `f${i}.jpg` })) as unknown as File[]
  assert('validatePhotoFiles rejects >10 files', validatePhotoFiles(tooMany) !== null)
}

function verifyStaticWiring() {
  console.log('\n6d. Phase 6 page wiring')

  const root = join(__dirname, '..')
  const page = readFileSync(join(root, 'app/(ui)/stock-count/page.tsx'), 'utf8')
  const uploadLib = readFileSync(join(root, 'lib/stock-count/upload.ts'), 'utf8')

  assert('resume drafts on load', page.includes('fetchResumableDrafts'))
  assert('resume uses single aggregate merge', page.includes('applyResumeDraftsToCounts'))
  assert('multi-file picker with mobile capture', page.includes('multiple') && page.includes('capture="environment"'))
  assert('direct Cloudinary upload', uploadLib.includes('api.cloudinary.com') && page.includes('uploadToCloudinary'))
  assert('extract after Cloudinary upload', page.includes('extractStockCountPhotos'))
  assert('draft thumbnails shown', page.includes('draft.imageUrl'))
  assert('unmatched review rows + product picker', page.includes('buildUnmatchedReviewRows') && page.includes('handleResolveRow'))
  assert('stale draft banner', page.includes('staleDrafts') && page.includes('STALE_DRAFT_MS'))
  assert('discard draft action', page.includes('handleDiscardDraft') && page.includes("'DISCARDED'"))
  assert('submit only contributing drafts', page.includes('draftIdsThatContributedToCounts'))
  assert('submit uses Phase 4 path', page.includes('buildAdjustmentTransactions') && page.includes('createManyTx'))
  // Word-level overlap (not the old whole-string substring): a description that
  // shares two real words matches the right product, not one that merely shares
  // a generic filler word.
  const catalog = [
    product('p-flex', 'Flexible Connector 1/2'),
    product('p-chrome', 'Chrome Bracket'),
  ]
  const overlapMatch = matchProduct('Magic Flexible Connector', catalog)
  assert('multi-word overlap matches the right product', overlapMatch.productId === 'p-flex')
  assert(
    'generic/stopword-only query does not spuriously match',
    matchProduct('Assorted General', catalog).status === 'unmatched',
  )
}

function main() {
  console.log('Stock Count — Phase 6 verification\n')
  verifyMatchingAndMerge()
  verifyResumeAndSubmitLifecycle()
  verifyClientValidation()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
