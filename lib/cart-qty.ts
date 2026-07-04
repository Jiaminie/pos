/** Preset increments for bulk cart adjustments. */
export const QTY_STEP_PRESETS = [10, 50, 100] as const

export function parseCartQty(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || n < 0) return null
  if (!Number.isInteger(n)) return Math.floor(n)
  return n
}

export function commitCartQty(raw: string, fallbackQty: number): number {
  const parsed = parseCartQty(raw)
  if (parsed === null) return fallbackQty
  return parsed
}
