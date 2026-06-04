const UNIT_SYMBOLS: [RegExp, string][] = [
  [/"/g, 'in'],
  [/'/g, 'ft'],
]

// Collapse to bare lowercase alphanumeric for fuzzy matching both sides
// "Braided Pipe 1\"" → "braidedpipe1in"
// "braidedpipe1\"" → "braidedpipe1in"
export function normalizeQuery(q: string): string {
  let s = q.toLowerCase()
  for (const [re, rep] of UNIT_SYMBOLS) s = s.replace(re, rep)
  return s.replace(/[^a-z0-9]/g, '')
}

// Generate a slug-style SKU from a product name + optional spec
// ("Braided Pipe", "1\"") → "braided-pipe-1in"
export function skuFromName(name: string, spec?: string): string {
  const combined = [name, spec].filter(Boolean).join(' ')
  let s = combined.toLowerCase()
  for (const [re, rep] of UNIT_SYMBOLS) s = s.replace(re, rep)
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Clean a product name typed without spaces/casing
// "BraidedPipe1\"" → "Braided Pipe 1\""
// "braidedpipe1\"" → "Braidedpipe 1\""
export function cleanProductName(raw: string): string {
  if (!raw.trim()) return raw
  let s = raw.trim()
  s = s
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase split
    .replace(/([A-Za-z])(\d)/g, '$1 $2')   // letter→digit
    .replace(/(\d)([A-Za-z])/g, '$1 $2')   // digit→letter
    .replace(/\s+/g, ' ')
    .trim()
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}
