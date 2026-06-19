import * as XLSX from 'xlsx'
import type { ImportColumnKey, RawImportRow } from './types'
import { DEFAULT_STOCK_PRICES_MAPPING } from './types'

function cellString(val: unknown): string {
  if (val == null) return ''
  return String(val).trim()
}

function parseNumber(val: unknown): number {
  const s = cellString(val)
  if (!s) return 0
  const num = parseFloat(s.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(num) ? num : 0
}

function parseOpeningStock(val: unknown): number {
  const n = parseNumber(val)
  return Math.max(0, Math.floor(n))
}

export function parsePrice(val: unknown): number {
  return Math.max(0, parseNumber(val))
}

function rowToArray(row: unknown[]): string[] {
  return row.map((c) => cellString(c))
}

function mapRow(
  cells: string[],
  rowIndex: number,
  columnMap: Record<ImportColumnKey, number | null>,
): RawImportRow | null {
  const nameIdx = columnMap.name
  if (nameIdx == null) return null

  const name = cells[nameIdx] ?? ''
  if (!name || name.toUpperCase() === 'ALL ITEMS') return null

  const specIdx = columnMap.specification
  const catIdx = columnMap.category
  const stockIdx = columnMap.openingStock
  const costIdx = columnMap.costPrice
  const sellIdx = columnMap.sellingPrice
  const skuIdx = columnMap.sku
  const barcodeIdx = columnMap.barcode

  return {
    rowIndex,
    openingStock: stockIdx != null ? parseOpeningStock(cells[stockIdx]) : 0,
    name,
    categoryRaw: catIdx != null ? (cells[catIdx] ?? '') : '',
    specification: specIdx != null ? (cells[specIdx] ?? '') : '',
    costPrice: costIdx != null ? parsePrice(cells[costIdx]) : 0,
    sellingPrice: sellIdx != null ? parsePrice(cells[sellIdx]) : 0,
    sku: skuIdx != null && cells[skuIdx] ? cells[skuIdx] : undefined,
    barcode: barcodeIdx != null && cells[barcodeIdx] ? cells[barcodeIdx] : undefined,
  }
}

export function parseSpreadsheetRows(
  rows: unknown[][],
  columnMap: Record<ImportColumnKey, number | null> = DEFAULT_STOCK_PRICES_MAPPING,
): RawImportRow[] {
  const parsed: RawImportRow[] = []
  for (let i = 0; i < rows.length; i++) {
    const cells = rowToArray(rows[i] as unknown[])
    const row = mapRow(cells, i + 1, columnMap)
    if (row) parsed.push(row)
  }
  return parsed
}

export function parseWorkbookBuffer(
  buffer: ArrayBuffer,
  columnMap: Record<ImportColumnKey, number | null> = DEFAULT_STOCK_PRICES_MAPPING,
): RawImportRow[] {
  const wb = XLSX.read(buffer, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  return parseSpreadsheetRows(rows, columnMap)
}

export function parseCsvText(
  text: string,
  columnMap: Record<ImportColumnKey, number | null> = DEFAULT_STOCK_PRICES_MAPPING,
): RawImportRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0) return []

  const firstCols = parseCsvLine(lines[0])
  const hasHeader = looksLikeHeader(firstCols)
  const dataLines = hasHeader ? lines.slice(1) : lines
  const effectiveMap = hasHeader
    ? detectColumnMap(firstCols)
    : columnMap

  const rows = dataLines.map((line) => parseCsvLine(line))
  return parseSpreadsheetRows(rows, effectiveMap)
}

function looksLikeHeader(cols: string[]): boolean {
  const joined = cols.join(' ').toLowerCase()
  return /name|product|sku|price|cost|sell|stock|qty|quantity/.test(joined)
}

function detectColumnMap(headers: string[]): Record<ImportColumnKey, number | null> {
  const map: Record<ImportColumnKey, number | null> = {
    openingStock: null,
    name: null,
    category: null,
    specification: null,
    costPrice: null,
    sellingPrice: null,
    sku: null,
    barcode: null,
  }

  headers.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    if (/^(qty|quantity|stock|opening|in stock|instock)/.test(key)) map.openingStock = i
    else if (/^(name|product|item)/.test(key)) map.name = i
    else if (/^(category|cat|type)/.test(key)) map.category = i
    else if (/^(spec|size|description|location|variant)/.test(key)) map.specification = i
    else if (/^(cost|wholesale|buy)/.test(key)) map.costPrice = i
    else if (/^(sell|retail|price|selling)/.test(key) && !/cost/.test(key)) map.sellingPrice = i
    else if (/^sku/.test(key)) map.sku = i
    else if (/^(barcode|ean|upc|gtin)/.test(key)) map.barcode = i
  })

  if (map.name == null) map.name = 0
  return map
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote && ch === '"') {
      if (line[i + 1] === '"') { cur += '"'; i++ }
      else inQuote = false
    } else if (!inQuote && ch === '"') {
      inQuote = true
    } else if (ch === ',' && !inQuote) {
      cols.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cols.push(cur.trim())
  return cols
}

export async function parseImportFile(
  file: File,
  columnMap?: Record<ImportColumnKey, number | null>,
): Promise<RawImportRow[]> {
  const map = columnMap ?? DEFAULT_STOCK_PRICES_MAPPING
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    return parseCsvText(await file.text(), map)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseWorkbookBuffer(await file.arrayBuffer(), map)
  }

  throw new Error('Unsupported file type. Use .xlsx, .xls, or .csv')
}
