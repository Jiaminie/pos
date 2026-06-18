import { cleanProductName, normalizeQuery, skuFromName, uniqueSku } from '@/lib/normalize'
import { inferBrand, normalizeBrand } from '@/lib/brands'
import { resolveCategory } from './categories'
import type {
  ImportPreviewResult,
  ImportPreviewRow,
  ImportPreviewSummary,
  RawImportRow,
} from './types'

type ExistingProduct = { id: string; sku: string }

function titleCaseLocation(raw: string): string {
  if (!raw.trim()) return ''
  return raw
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Resolve duplicate names using location/spec as variant suffix. */
function applyVariantSuffixes(rows: RawImportRow[]): Array<RawImportRow & { specification: string }> {
  const byName = new Map<string, RawImportRow[]>()
  for (const row of rows) {
    const key = normalizeQuery(row.name)
    const group = byName.get(key) ?? []
    group.push(row)
    byName.set(key, group)
  }

  const result: Array<RawImportRow & { specification: string }> = []

  for (const group of byName.values()) {
    const locationCounts = new Map<string, number>()
    for (const row of group) {
      let spec = titleCaseLocation(row.specification)
      if (group.length > 1) {
        if (!spec) {
          const n = (locationCounts.get('') ?? 0) + 1
          locationCounts.set('', n)
          spec = n > 1 ? `Variant ${n}` : ''
        } else {
          const n = (locationCounts.get(spec) ?? 0) + 1
          locationCounts.set(spec, n)
          if (n > 1) spec = `${spec} (${n})`
        }
      }
      result.push({ ...row, specification: spec })
    }
  }

  return result.sort((a, b) => a.rowIndex - b.rowIndex)
}

function assignSkus(
  rows: Array<RawImportRow & { specification: string }>,
): Array<RawImportRow & { specification: string; sku: string }> {
  const used = new Set<string>()
  const out: Array<RawImportRow & { specification: string; sku: string }> = []

  for (const row of rows) {
    let base = row.sku?.trim() || skuFromName(row.name, row.specification || undefined)
    if (!base) base = `item-${row.rowIndex}`
    const sku = uniqueSku(base, used)
    used.add(sku)
    out.push({ ...row, sku })
  }

  return out
}

function buildPreviewRow(
  row: RawImportRow & { specification: string; sku: string },
  existingBySku: Map<string, ExistingProduct>,
): ImportPreviewRow {
  const errors: string[] = []
  const warnings: string[] = []
  const name = cleanProductName(row.name)

  if (!name) errors.push('Name is required')

  const existing = existingBySku.get(row.sku)
  const action = existing ? 'update' : 'create'

  if (row.costPrice <= 0) warnings.push('Missing cost price')
  if (row.sellingPrice <= 0) warnings.push('Missing selling price')

  let status: ImportPreviewRow['status'] = 'ok'
  if (errors.length > 0) status = 'error'
  else if (row.costPrice <= 0 || row.sellingPrice <= 0) status = 'missing_price'

  return {
    rowIndex: row.rowIndex,
    name,
    specification: row.specification || undefined,
    sku: row.sku,
    category: resolveCategory(row.categoryRaw, name),
    brand: normalizeBrand(inferBrand({ name, sku: row.sku, brand: '' })),
    openingStock: row.openingStock,
    costPrice: row.costPrice,
    sellingPrice: row.sellingPrice,
    lowestPrice: null,
    status,
    errors,
    warnings,
    action,
    existingProductId: existing?.id,
  }
}

function buildSummary(rows: ImportPreviewRow[], duplicateNameGroups: number): ImportPreviewSummary {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === 'ok').length,
    missingPrice: rows.filter((r) => r.status === 'missing_price').length,
    errors: rows.filter((r) => r.status === 'error').length,
    toCreate: rows.filter((r) => r.action === 'create').length,
    toUpdate: rows.filter((r) => r.action === 'update').length,
    duplicateNameGroups,
  }
}

export function buildImportPreview(
  rawRows: RawImportRow[],
  existingProducts: ExistingProduct[] = [],
): ImportPreviewResult {
  const existingBySku = new Map(existingProducts.map((p) => [p.sku, p]))

  const nameGroups = new Map<string, number>()
  for (const row of rawRows) {
    const key = normalizeQuery(row.name)
    nameGroups.set(key, (nameGroups.get(key) ?? 0) + 1)
  }
  const duplicateNameGroups = [...nameGroups.values()].filter((n) => n > 1).length

  const withSpecs = applyVariantSuffixes(rawRows)
  const withSkus = assignSkus(withSpecs)
  const rows = withSkus.map((r) => buildPreviewRow(r, existingBySku))

  return {
    rows,
    summary: buildSummary(rows, duplicateNameGroups),
  }
}
