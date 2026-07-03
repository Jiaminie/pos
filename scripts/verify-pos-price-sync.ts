/**
 * Verifies POS cart pricing is isolated from the product catalog.
 * Run: npx tsx scripts/verify-pos-price-sync.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clampCartUnitPrice, clampUnitPrice } from '../lib/pricing'
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

function main() {
  console.log('POS cart vs catalog price isolation')

  console.log('\n1. Cart can discount or markup without changing list price')
  const product: Product = {
    id: 'p1',
    name: 'Mixer',
    sku: 'MIX-1',
    sellingPrice: 2300,
    costPrice: 1000,
    lowestPrice: 2250,
    categoryId: 'cat',
    brand: 'BRASSCO',
  }
  const cartLine = { ...product, qty: 1, unitPrice: 2300 }
  assert('cart discount below list respects floor', clampCartUnitPrice(cartLine, 2200) === 2250)
  assert('cart discount within range', clampCartUnitPrice(cartLine, 2280) === 2280)
  assert('cart markup above list', clampCartUnitPrice(cartLine, 2400) === 2400)
  assert('% buttons still cap at list', clampUnitPrice(cartLine, 2400) === 2300)

  console.log('\n2. POS save does not PATCH the catalog')
  const posSource = readFileSync(join(process.cwd(), 'app/(ui)/pos/page.tsx'), 'utf8')
  assert('no upsertProducts in POS page', !posSource.includes('upsertProducts'))
  assert('no pushProductSync in POS page', !posSource.includes('pushProductSync'))
  assert('save updates unitPrice only', posSource.includes('unitPrice: clamped') && !posSource.includes('sellingPrice: clamped'))
  assert('checkout keeps originalUnitPrice from list', posSource.includes('originalUnitPrice: item.sellingPrice'))

  console.log('\n3. Products page still owns catalog prices')
  const productsSource = readFileSync(join(process.cwd(), 'app/(ui)/products/page.tsx'), 'utf8')
  assert('products page upserts catalog', productsSource.includes('upsertMany'))
  assert('products table shows sellingPrice', productsSource.includes('{p.sellingPrice.toLocaleString()}'))

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main()
