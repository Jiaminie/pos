export type PosLookupMode = 'catalog' | 'barcode' | 'hybrid'

export const POS_LOOKUP_MODES: {
  value: PosLookupMode
  label: string
  description: string
}[] = [
  {
    value: 'catalog',
    label: 'Catalog search',
    description: 'Browse and search by name, SKU, brand, category, and size — best for hardware and building supplies.',
  },
  {
    value: 'barcode',
    label: 'Barcode scanner',
    description: 'Scan barcodes to add items instantly — best for retail and convenience stores.',
  },
  {
    value: 'hybrid',
    label: 'Barcode + catalog',
    description: 'Scan barcodes or search the full catalog — best for supermarkets and mixed stock.',
  },
]

export function parsePosLookupMode(value: unknown): PosLookupMode {
  if (value === 'barcode' || value === 'hybrid' || value === 'catalog') return value
  return 'catalog'
}

export function defaultPosLookupMode(): PosLookupMode {
  const env = process.env.POS_LOOKUP_MODE
  return parsePosLookupMode(env)
}

export type ReceiptFormat = 'a4' | '80mm' | '58mm'

export const RECEIPT_FORMATS: {
  value: ReceiptFormat
  label: string
  description: string
}[] = [
  {
    value: 'a4',
    label: 'A4 sheet',
    description: 'Full-page receipts and quotations — best for office/inkjet/laser printers and PDF sharing.',
  },
  {
    value: '80mm',
    label: 'Thermal 80mm',
    description: 'Narrow roll for 80mm thermal & ETR receipt printers — the common till-roll width.',
  },
  {
    value: '58mm',
    label: 'Thermal 58mm',
    description: 'Compact roll for small 58mm thermal & mobile receipt printers.',
  },
]

export function parseReceiptFormat(value: unknown): ReceiptFormat {
  if (value === '80mm' || value === '58mm' || value === 'a4') return value
  return 'a4'
}

/** Roll width in mm for a thermal format, or null for full-page A4. */
export function receiptWidthMm(format: ReceiptFormat): number | null {
  if (format === '80mm') return 80
  if (format === '58mm') return 58
  return null
}

export interface PDFSettings {
  companyName: string
  tagline: string
  logoDataUrl: string      // base64 data URL or empty string
  primaryColor: string     // hex e.g. "#2563eb"
  currency: string
  footerText: string
  /** Min sell price as % of cost (150 = 1.5× cost). Drives discount floor in POS. */
  minMarkupPercent: number
  /** How cashiers find products at the register. */
  posLookupMode: PosLookupMode
  /** Paper format for printed receipts & quotations (A4 vs thermal roll widths). */
  receiptFormat: ReceiptFormat
  /** Heading printed on the sales receipt, e.g. "RECEIPT", "SALES RECEIPT". */
  receiptTitle: string
}

export const DEFAULT_SETTINGS: PDFSettings = {
  companyName: 'My Business',
  tagline: '',
  logoDataUrl: '',
  primaryColor: '#2563eb',
  currency: 'KES',
  footerText: 'Thank you for your business.',
  minMarkupPercent: 150,
  posLookupMode: 'catalog',
  receiptFormat: 'a4',
  receiptTitle: 'RECEIPT',
}

const KEY = 'pos-pdf-settings'

/** Read from localStorage (used by PDF generation which is always client-side) */
export function loadSettings(): PDFSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PDFSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      posLookupMode: parsePosLookupMode(parsed.posLookupMode),
      receiptFormat: parseReceiptFormat(parsed.receiptFormat),
      receiptTitle: typeof parsed.receiptTitle === 'string' ? parsed.receiptTitle : DEFAULT_SETTINGS.receiptTitle,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Write to localStorage cache */
export function cacheSettings(s: PDFSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Fetch from server and cache locally. Returns the authoritative settings. */
export async function fetchSettings(): Promise<PDFSettings> {
  try {
    const res = await fetch('/api/settings')
    if (!res.ok) throw new Error('fetch failed')
    const { data } = await res.json()
    const s: PDFSettings = {
      companyName:  data.companyName  ?? DEFAULT_SETTINGS.companyName,
      tagline:      data.tagline      ?? DEFAULT_SETTINGS.tagline,
      logoDataUrl:  data.logoDataUrl  ?? DEFAULT_SETTINGS.logoDataUrl,
      primaryColor: data.primaryColor ?? DEFAULT_SETTINGS.primaryColor,
      currency:     data.currency     ?? DEFAULT_SETTINGS.currency,
      footerText:   data.footerText   ?? DEFAULT_SETTINGS.footerText,
      minMarkupPercent: Number(data.minMarkupPercent ?? DEFAULT_SETTINGS.minMarkupPercent),
      posLookupMode: parsePosLookupMode(data.posLookupMode),
      receiptFormat: parseReceiptFormat(data.receiptFormat),
      receiptTitle: data.receiptTitle ?? DEFAULT_SETTINGS.receiptTitle,
    }
    cacheSettings(s)
    return s
  } catch {
    return loadSettings()
  }
}

/** Persist to server and update local cache. */
export async function saveSettings(s: PDFSettings): Promise<void> {
  cacheSettings(s)
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  if (!res.ok) throw new Error('Failed to save settings'  )
}

/** Convert "#rrggbb" → [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const n = parseInt(clean, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
