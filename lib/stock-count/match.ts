import { getProductBrand } from '@/lib/brands'
import type { Product } from '@/lib/types'
import type { ReviewRowStatus } from './types'

export type ProductMatchResult = {
  productId: string | null
  status: ReviewRowStatus
  score: number
  productName: string | null
}

// Dice-coefficient thresholds (0–1). Tuned so a near-complete word overlap
// auto-matches, a partial overlap asks for review, and weak/no overlap is left
// unmatched rather than surfacing a misleading suggestion.
const MATCH_THRESHOLD = 0.6
const REVIEW_THRESHOLD = 0.34
const AMBIGUITY_MARGIN = 0.1

// Generic words that appear across the catalog (brand/spec fillers, packaging
// units) — they create spurious overlap, so they're dropped before scoring.
const STOPWORDS = new Set([
  'general',
  'unbranded',
  'assorted',
  'mixed',
  'std',
  'standard',
  'size',
  'pcs',
  'pc',
  'pkt',
  'pack',
  'set',
  'the',
  'and',
  'for',
  'with',
])

/** Split into real words: lowercase, map inch/foot marks, break on any
 *  non-alphanumeric, then drop pure numbers, 1-char tokens, and stopwords
 *  (which carry no discriminating signal for a hardware catalog). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/"/g, 'in')
    .replace(/'/g, 'ft')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
}

/**
 * The token sets a product may be recognised under: its formal catalog name,
 * and — when set — its shop-floor alias.
 *
 * These are kept as SEPARATE candidates rather than concatenated on purpose.
 * The score is Dice (2·shared / (|q| + |c|)), so appending alias tokens to the
 * formal set would inflate |c| and *lower* the score of every aliased product
 * whose alias happens not to match — an alias would then hurt the products it
 * was added to help. Scoring each set independently and keeping the best means
 * an alias can only ever raise a product's score.
 */
function productTokenSets(product: Product): string[][] {
  const brand = tokenize(getProductBrand(product))
  const spec = tokenize(product.specification ?? '')
  const sets = [[...tokenize(product.name), ...spec, ...brand]]

  const alias = tokenize(product.alias ?? '')
  if (alias.length > 0) sets.push([...alias, ...spec, ...brand])

  return sets
}

type Overlap = { score: number; exactShared: number }

/** Symmetric (Dice) token overlap with partial credit for word variants
 *  (e.g. "flex" ↔ "flexible"). Normalizing by both token counts keeps a long
 *  product name from trivially "containing" a short query. */
function overlap(qTokens: string[], cTokens: string[]): Overlap {
  if (qTokens.length === 0 || cTokens.length === 0) return { score: 0, exactShared: 0 }
  const cSet = new Set(cTokens)
  let shared = 0
  let exactShared = 0
  for (const q of qTokens) {
    if (cSet.has(q)) {
      shared += 1
      exactShared += 1
      continue
    }
    // Prefix-variant credit: "flex" vs "flexible", "connect" vs "connector".
    if (q.length >= 4 && cTokens.some((c) => c.length >= 4 && (c.startsWith(q) || q.startsWith(c)))) {
      shared += 0.6
    }
  }
  const score = (2 * shared) / (qTokens.length + cTokens.length)
  return { score, exactShared }
}

export function matchProduct(description: string, products: Product[]): ProductMatchResult {
  const qTokens = tokenize(description)
  if (qTokens.length === 0) {
    return { productId: null, status: 'unmatched', score: 0, productName: null }
  }

  let best: { product: Product; score: number; exactShared: number } | null = null
  let secondBest = 0

  for (const product of products) {
    // Best of the product's name-based and alias-based token sets.
    let score = 0
    let exactShared = 0
    for (const cTokens of productTokenSets(product)) {
      const o = overlap(qTokens, cTokens)
      if (o.score > score) {
        score = o.score
        exactShared = o.exactShared
      }
    }
    if (score <= 0) continue

    if (!best || score > best.score) {
      secondBest = best?.score ?? 0
      best = { product, score, exactShared }
    } else if (score > secondBest) {
      secondBest = score
    }
  }

  if (!best || best.score < REVIEW_THRESHOLD) {
    return { productId: null, status: 'unmatched', score: best?.score ?? 0, productName: null }
  }

  // Auto-match (skips human review) demands a strong, unambiguous overlap: at
  // least two exact words in common, or an identical token set. A single shared
  // word is too weak to auto-count — it routes to review with a suggestion.
  const ambiguous = best.score - secondBest < AMBIGUITY_MARGIN
  const strongOverlap = best.exactShared >= 2 || (best.score >= 0.999 && best.exactShared >= 1)
  const status: ReviewRowStatus =
    best.score >= MATCH_THRESHOLD && strongOverlap && !ambiguous ? 'matched' : 'needs_review'

  return {
    productId: best.product.id,
    status,
    score: best.score,
    productName: best.product.name,
  }
}
