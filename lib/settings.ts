export interface PDFSettings {
  companyName: string
  tagline: string
  logoDataUrl: string      // base64 data URL or empty string
  primaryColor: string     // hex e.g. "#2563eb"
  currency: string
  footerText: string
}

export const DEFAULT_SETTINGS: PDFSettings = {
  companyName: 'My Business',
  tagline: '',
  logoDataUrl: '',
  primaryColor: '#2563eb',
  currency: 'KES',
  footerText: 'Thank you for your business.',
}

const KEY = 'pos-pdf-settings'

/** Read from localStorage (used by PDF generation which is always client-side) */
export function loadSettings(): PDFSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
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
