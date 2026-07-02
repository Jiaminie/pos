import { getProductBrand } from '@/lib/brands'
import { normalizeQuery } from '@/lib/normalize'
import type { Product } from '@/lib/types'
import type { ReviewRowStatus } from './types'

export type ProductMatchResult = {
  productId: string | null
  status: ReviewRowStatus
  score: number
  productName: string | null
}

const MATCH_THRESHOLD = 0.65
const REVIEW_THRESHOLD = 0.35
// Below this normalized length, a query is too short/garbled (likely a
// misread OCR fragment) to trust for a confident auto-match — it can only
// ever earn partial credit, even on an exact substring/token hit.
const MIN_CONFIDENT_LENGTH = 3

function tokenize(text: string): string[] {
  return normalizeQuery(text).split(/\s+/).filter(Boolean)
}

function scoreTokens(query: string, candidate: string): number {
  const q = normalizeQuery(query)
  const c = normalizeQuery(candidate)
  if (!q || !c) return 0
  if (q === c) return 1

  if (c.includes(q) || q.includes(c)) {
    // Scale by how much of the longer string the shorter one actually covers,
    // so a short fragment merely appearing inside an unrelated long name
    // (e.g. "10" inside a SKU) doesn't score as high as a near-full match.
    const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length)
    return q.length >= MIN_CONFIDENT_LENGTH ? 0.5 + 0.45 * ratio : 0.5 * ratio
  }

  const qTokens = tokenize(q)
  const cTokens = tokenize(c)
  if (qTokens.length === 0 || cTokens.length === 0) return 0

  let hits = 0
  for (const token of qTokens) {
    // A short token (e.g. a 2-letter OCR fragment) matching exactly is still
    // too weak on its own to justify auto-matching without review.
    if (token.length < MIN_CONFIDENT_LENGTH) {
      if (cTokens.includes(token)) hits += 0.5
      continue
    }
    if (cTokens.includes(token)) {
      hits += 1
      continue
    }
    if (cTokens.some((ct) => ct.includes(token) || token.includes(ct))) {
      hits += 0.5
    }
  }
  return hits / qTokens.length
}

function productCandidates(product: Product): string[] {
  const brand = getProductBrand(product)
  const parts = [product.name, product.specification, brand, product.sku].filter(Boolean)
  return parts as string[]
}

export function matchProduct(description: string, products: Product[]): ProductMatchResult {
  let best: { product: Product; score: number } | null = null
  let secondBest = 0

  for (const product of products) {
    const scores = productCandidates(product).map((c) => scoreTokens(description, c))
    const score = scores.length > 0 ? Math.max(...scores) : 0

    if (!best || score > best.score) {
      secondBest = best?.score ?? 0
      best = { product, score }
    } else if (score > secondBest) {
      secondBest = score
    }
  }

  if (!best || best.score < REVIEW_THRESHOLD) {
    return {
      productId: null,
      status: 'unmatched',
      score: best?.score ?? 0,
      productName: null,
    }
  }

  const ambiguous = best.score - secondBest < 0.12
  if (best.score >= MATCH_THRESHOLD && !ambiguous) {
    return {
      productId: best.product.id,
      status: 'matched',
      score: best.score,
      productName: best.product.name,
    }
  }

  return {
    productId: best.product.id,
    status: 'needs_review',
    score: best.score,
    productName: best.product.name,
  }
}
