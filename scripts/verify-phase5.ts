/**
 * Phase 5 verification — photo upload & extraction backend.
 * Run: npm run verify:phase5
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidStockCountImageUrl } from '../lib/server/stock-count/cloudinary'
import { anthropicConfigured } from '../lib/server/stock-count/extract'

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

function verifyCloudinaryUrlValidation() {
  console.log('\n5a. Cloudinary URL validation (before Claude calls)')
  process.env.CLOUDINARY_CLOUD_NAME = 'demo'

  const valid = 'https://res.cloudinary.com/demo/image/upload/v1/pos/stock-count/form.jpg'
  assert('valid stock-count URL accepted', isValidStockCountImageUrl(valid))
  assert(
    'wrong folder rejected',
    !isValidStockCountImageUrl('https://res.cloudinary.com/demo/image/upload/v1/pos/products/x.jpg'),
  )
  assert(
    'wrong cloud name rejected',
    !isValidStockCountImageUrl('https://res.cloudinary.com/other/image/upload/v1/pos/stock-count/x.jpg'),
  )
  assert('http rejected', !isValidStockCountImageUrl('http://res.cloudinary.com/demo/image/upload/v1/pos/stock-count/x.jpg'))
  assert(
    'non-cloudinary host rejected',
    !isValidStockCountImageUrl('https://evil.example/image/upload/demo/pos/stock-count/x.jpg'),
  )
  assert(
    'cloudinary.com suffix spoof rejected',
    !isValidStockCountImageUrl('https://notcloudinary.com/demo/image/upload/v1/pos/stock-count/x.jpg'),
  )
}

function verifyRateLimit() {
  console.log('\n5b. Extract rate limiting')
  const rateLimitLib = readFileSync(
    join(__dirname, '../lib/server/stock-count/rateLimit.ts'),
    'utf8',
  )
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

function verifyAnthropicConfig() {
  console.log('\n5c. Anthropic graceful failure')
  const extractLib = readFileSync(join(__dirname, '../lib/server/stock-count/extract.ts'), 'utf8')
  assert('missing key has explicit error message', extractLib.includes('ANTHROPIC_API_KEY is not configured'))
  assert('uses messages.parse with structured output', extractLib.includes('messages.parse'))
  assert('image source uses URL block', extractLib.includes("source: { type: 'url', url: imageUrl }"))
  assert('model claude-opus-4-8', extractLib.includes("'claude-opus-4-8'"))
  if (!anthropicConfigured()) {
    console.log('  ⚠ ANTHROPIC_API_KEY not set — live extraction E2E skipped')
  } else {
    ok('ANTHROPIC_API_KEY present in environment')
  }
}

function verifyStaticWiring() {
  console.log('\n5d. Phase 5 endpoint wiring')

  const root = join(__dirname, '..')
  const sigRoute = readFileSync(join(root, 'app/api/stock-count/upload-signature/route.ts'), 'utf8')
  const extractRoute = readFileSync(join(root, 'app/api/stock-count/extract/route.ts'), 'utf8')
  const completeRoute = readFileSync(join(root, 'app/api/stock-count/uploads/complete/route.ts'), 'utf8')
  const pkg = readFileSync(join(root, 'package.json'), 'utf8')

  assert('upload-signature requires stock.count.adjust', sigRoute.includes("'stock.count.adjust'"))
  assert('upload-signature uses signed Cloudinary payload', sigRoute.includes('createStockCountUploadSignature'))
  assert('upload-signature checks cloudinary env', sigRoute.includes('cloudinaryEnvReady'))
  assert('extract POST requires stock.count.adjust', extractRoute.includes("'stock.count.adjust'"))
  assert('extract caps batch at 10 images', extractRoute.includes('MAX_IMAGES = 10'))
  const extractPost = extractRoute.slice(extractRoute.indexOf('export async function POST'))
  assert(
    'extract validates URLs before rate limit',
    extractPost.indexOf('invalidUrls') < extractPost.indexOf('checkExtractRateLimit(user.userId)'),
  )
  assert('extract uses bounded concurrency', extractRoute.includes('EXTRACT_CONCURRENCY = 3'))
  assert('PENDING row created before Claude call', extractRoute.includes("status: 'PENDING'") && extractRoute.includes('prisma.stockCountUpload.create'))
  assert('GET resume uses RESUMABLE_DRAFT_STATUSES', extractRoute.includes('RESUMABLE_DRAFT_STATUSES'))
  assert('per-image ERROR does not abort batch', extractRoute.includes("status: 'ERROR'"))
  assert('complete requires branchId', completeRoute.includes("'branchId is required'"))
  assert('complete supports SUBMITTED/DISCARDED', completeRoute.includes("'SUBMITTED'") && completeRoute.includes("'DISCARDED'"))
  assert('@anthropic-ai/sdk in package.json', pkg.includes('@anthropic-ai/sdk'))
}

function main() {
  console.log('Stock Count — Phase 5 verification\n')
  verifyCloudinaryUrlValidation()
  verifyRateLimit()
  verifyAnthropicConfig()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
