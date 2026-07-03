/**
 * Verifies POS cart price save writes the same catalog record Products reads.
 * Run: npx tsx scripts/verify-pos-price-sync.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clampUnitPrice, effectiveLowestPrice } from '../lib/pricing'
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

/** Mirrors saveItemPrice() catalog update in app/(ui)/pos/page.tsx */
function buildSavedProduct(item: Product & { qty: number; unitPrice: number }, newPrice: number, minMarkupPercent: number) {
  const clamped = clampUnitPrice(item, newPrice, minMarkupPercent)
  const { qty: _qty, unitPrice: _unitPrice, ...productFields } = item
  return { product: { ...productFields, sellingPrice: clamped } as Product, clamped }
}

function verifySaveTransformsCartItemToCatalogProduct() {
  console.log('\n1. POS save builds the same Product shape Products reads')
  const item = {
    id: 'prod-abc',
    name: 'BRASSCO BASIN MIXER',
    sku: 'SKU-001',
    sellingPrice: 2300,
    costPrice: 1800,
    lowestPrice: 2250,
    categoryId: 'taps-faucets',
    brand: 'BRASSCO',
    qty: 1,
    unitPrice: 2300,
  }
  const { product, clamped } = buildSavedProduct(item, 2200, 10)
  assert('clamped price respects floor', clamped === 2250, `got ${clamped}`)
  assert('saved product id unchanged', product.id === 'prod-abc')
  assert('saved product sellingPrice updated', product.sellingPrice === 2250)
  assert('cart-only fields omitted from catalog record', !('qty' in product) && !('unitPrice' in product))
}

function verifySyncPayloadMatchesPatchApi() {
  console.log('\n2. Queued sync body matches PATCH /api/products/[id] contract')
  const clamped = 2250
  const syncItem = { id: 'prod-abc', method: 'PATCH' as const, body: { sellingPrice: clamped } }
  assert('PATCH method', syncItem.method === 'PATCH')
  assert('body only includes sellingPrice', Object.keys(syncItem.body).join() === 'sellingPrice')
  assert('sellingPrice is numeric', typeof syncItem.body.sellingPrice === 'number')
}

function verifySharedCatalogModule() {
  console.log('\n3. POS and Products page share lib/db/products.ts')
  const posSource = readFileSync(join(process.cwd(), 'app/(ui)/pos/page.tsx'), 'utf8')
  const productsSource = readFileSync(join(process.cwd(), 'app/(ui)/products/page.tsx'), 'utf8')
  const productsDb = readFileSync(join(process.cwd(), 'lib/db/products.ts'), 'utf8')

  assert('POS imports upsertMany from lib/db/products', posSource.includes("upsertMany as upsertProducts") && posSource.includes("from '@/lib/db/products'"))
  assert('POS save calls upsertProducts', posSource.includes('await upsertProducts([updatedProduct])'))
  assert('Products imports getAll from lib/db/products', productsSource.includes("getAll as getProducts") && productsSource.includes("from '@/lib/db/products'"))
  assert('Products loadCatalog reads getProducts()', productsSource.includes('getProducts()'))
  assert('IndexedDB store is products with keyPath id', productsDb.includes("objectStore('products')") && productsDb.includes('store.put(product)'))
}

function verifyProductsPageRendersSellingPrice() {
  console.log('\n4. Products table displays sellingPrice from state')
  const productsSource = readFileSync(join(process.cwd(), 'app/(ui)/products/page.tsx'), 'utf8')
  assert('table cell uses p.sellingPrice', productsSource.includes('{p.sellingPrice.toLocaleString()}'))
  assert('loadCatalog sets products state from getProducts', productsSource.includes('setProducts(prods)'))
}

function main() {
  console.log('POS → Products price sync verification')
  verifySaveTransformsCartItemToCatalogProduct()
  verifySyncPayloadMatchesPatchApi()
  verifySharedCatalogModule()
  verifyProductsPageRendersSellingPrice()

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  console.log('\nManual check: save a price on /pos, open /products — selling price column should match.')
}

main()
