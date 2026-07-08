import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { loadSettings, hexToRgb, receiptWidthMm, type PDFSettings } from './settings'

// ─── print ──────────────────────────────────────────────────────────────────

/**
 * Open the browser print dialog for a generated PDF, so it can be sent to a
 * connected printer. Loads the PDF into a hidden iframe (avoids popup blockers)
 * and triggers print once it has rendered.
 */
export function printPDF(doc: jsPDF) {
  doc.autoPrint()
  const blobUrl = doc.output('bloburl')

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.src = String(blobUrl)

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      // Fallback: open in a new tab if the iframe can't be printed directly
      window.open(String(blobUrl), '_blank')
    }
    // Clean up after the dialog has had time to open
    setTimeout(() => iframe.remove(), 60_000)
  }

  document.body.appendChild(iframe)
}

// ─── helpers ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number]

const GRAY_BG: RGB  = [243, 244, 246]  // section header fill
const GRAY_TXT: RGB = [107, 114, 128]  // small labels
const DARK: RGB     = [17,  24,  39]   // headings / values
const WHITE: RGB    = [255, 255, 255]

const PAGE_W  = 210  // A4 mm
const MARGIN  = 16
const CONTENT = PAGE_W - MARGIN * 2

/** Draw the page header: logo (if any), company name, subtitle, blue rule */
function drawHeader(
  doc: jsPDF,
  title: string,
  subtitle: string,
  settings: PDFSettings,
): number {
  const primary = hexToRgb(settings.primaryColor)
  let y = MARGIN

  // Logo
  if (settings.logoDataUrl) {
    try {
      doc.addImage(settings.logoDataUrl, 'PNG', MARGIN, y, 18, 18)
      y += 2
    } catch { /* skip broken logo */ }
  }

  const textX = settings.logoDataUrl ? MARGIN + 22 : MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...DARK)
  doc.text(title, textX, y + (settings.logoDataUrl ? 7 : 0))

  y += settings.logoDataUrl ? 14 : 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY_TXT)
  doc.text(subtitle, textX, y)
  y += 5

  // Blue rule
  doc.setDrawColor(...primary)
  doc.setLineWidth(0.6)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 7

  return y
}

/** Draw a section box: gray header with blue title, returns y after header */
function drawSectionHeader(doc: jsPDF, title: string, y: number, primary: RGB): number {
  doc.setFillColor(...GRAY_BG)
  doc.roundedRect(MARGIN, y, CONTENT, 10, 1.5, 1.5, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...primary)
  doc.text(title, MARGIN + 5, y + 6.8)
  return y + 14
}

/** Draw a KPI grid row (up to 4 cols).  Returns y after the block. */
function drawKPIRow(
  doc: jsPDF,
  kpis: Array<{ label: string; value: string }>,
  y: number,
): number {
  const colW = CONTENT / kpis.length
  kpis.forEach(({ label, value }, i) => {
    const x = MARGIN + i * colW
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY_TXT)
    doc.text(label, x, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...DARK)
    doc.text(value, x, y + 7)
  })
  return y + 16
}

/** Add page footer: page number + footer text */
function addFooters(doc: jsPDF, settings: PDFSettings) {
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY_TXT)
    doc.text(settings.footerText, MARGIN, 290)
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, 290, { align: 'right' })
  }
}

/** Payment details block for A4 receipts and quotations. Returns y after the block. */
function drawPaymentDetailsA4(doc: jsPDF, settings: PDFSettings, y: number, primary: RGB): number {
  const text = settings.paymentDetails?.trim()
  if (!text) return y

  y = drawSectionHeader(doc, 'Payment details', y, primary)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  ;(doc.splitTextToSize(text, CONTENT - 10) as string[]).forEach((line) => {
    doc.text(line, MARGIN + 5, y)
    y += 5
  })
  return y + 4
}

/** Payment details block for thermal receipts and quotations. Mutates y in place. */
function drawPaymentDetailsThermal(
  doc: jsPDF,
  settings: PDFSettings,
  y: number,
  m: number,
  width: number,
  rule: () => void,
): number {
  const text = settings.paymentDetails?.trim()
  if (!text) return y

  rule()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...DARK)
  doc.text('Payment details', m, y)
  y += 3.6
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...GRAY_TXT)
  ;(doc.splitTextToSize(text, width - 2 * m) as string[]).forEach((line) => {
    doc.text(line, m, y)
    y += 3.6
  })
  return y + 0.5
}

// ─── Quotation ────────────────────────────────────────────────────────────────

export interface QuotationItem {
  name: string
  sku: string
  specification?: string
  stockUnit?: string
  qty: number
  unitPrice: number
}

export interface QuotationData {
  customerName: string
  customerPhone?: string
  note?: string
  items: QuotationItem[]
  date: string
  quoteRef: string
}

export function generateQuotationPDF(data: QuotationData): jsPDF {
  const settings = loadSettings()
  const primary  = hexToRgb(settings.primaryColor)
  const cur      = settings.currency

  // Thermal roll formats use a dedicated single-column layout.
  const rollWidth = receiptWidthMm(settings.receiptFormat)
  if (rollWidth) {
    return buildThermalPDF({
      title: 'QUOTATION',
      refLabel: 'Ref',
      refValue: data.quoteRef,
      date: data.date,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      items: data.items,
      total: data.items.reduce((s, i) => s + i.qty * i.unitPrice, 0),
      note: data.note,
    }, settings, rollWidth)
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  let y = drawHeader(
    doc,
    settings.companyName,
    `Quotation • ${data.date}`,
    settings,
  )

  // ── Quotation meta
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY_TXT)
  doc.text(`Reference: ${data.quoteRef}`, MARGIN, y)
  y += 10

  // ── Bill To section
  y = drawSectionHeader(doc, 'Bill To', y, primary)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...DARK)
  doc.text(data.customerName, MARGIN + 5, y)
  y += 6
  if (data.customerPhone) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY_TXT)
    doc.text(data.customerPhone, MARGIN + 5, y)
    y += 6
  }
  y += 4

  // ── Summary KPI row
  const total   = data.items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const units   = data.items.reduce((s, i) => s + i.qty, 0)
  y = drawSectionHeader(doc, 'Summary', y, primary)
  y = drawKPIRow(doc, [
    { label: 'Date & Time', value: data.date },
    { label: 'Total Items', value: String(units) },
    { label: `Total (${cur})`, value: `${cur} ${total.toLocaleString()}` },
  ], y)
  y += 4

  // ── Line items table
  y = drawSectionHeader(doc, 'Items', y, primary)
  autoTable(doc, {
    startY: y,
    head: [['Product', 'Spec / Size', 'SKU', 'Qty', `Unit Price (${cur})`, `Amount (${cur})`]],
    body: data.items.map((i) => [
      i.name,
      i.specification ?? '—',
      i.sku,
      `${i.qty}${i.stockUnit ? ' ' + i.stockUnit : ''}`,
      i.unitPrice.toLocaleString(),
      (i.qty * i.unitPrice).toLocaleString(),
    ]),
    foot: [['', '', '', 'TOTAL', `${cur} ${total.toLocaleString()}`]],
    footStyles: { fontStyle: 'bold', fillColor: primary, textColor: WHITE },
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })

  const tableEnd = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY

  // ── Note / Terms
  let afterContentY = tableEnd + 10
  if (data.note) {
    const noteY = tableEnd + 10
    doc.setFillColor(...GRAY_BG)
    doc.roundedRect(MARGIN, noteY, CONTENT, 14, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY_TXT)
    doc.text('Note / Terms', MARGIN + 5, noteY + 6)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...DARK)
    doc.text(data.note, MARGIN + 5, noteY + 11)
    afterContentY = noteY + 20
  }

  drawPaymentDetailsA4(doc, settings, afterContentY, primary)

  addFooters(doc, settings)
  return doc
}

// ─── Thermal roll (80mm / 58mm receipt printers) ──────────────────────────────

interface ThermalLine {
  name: string
  sku?: string
  qty: number
  unitPrice: number
  stockUnit?: string
}

interface ThermalDoc {
  title: string        // 'RECEIPT' | 'QUOTATION'
  refLabel: string     // 'Order' | 'Ref'
  refValue: string
  date: string
  customerName?: string
  customerPhone?: string
  items: ThermalLine[]
  total: number
  note?: string
}

/**
 * Draw a single-column receipt sized for a thermal roll. Returns the final y
 * so the page can be sized to its content (no trailing blank feed).
 */
function drawThermal(doc: jsPDF, data: ThermalDoc, settings: PDFSettings, width: number): number {
  const cur     = settings.currency
  const primary = hexToRgb(settings.primaryColor)
  const m       = width >= 80 ? 5 : 4   // side margin
  const right   = width - m
  let y = 6

  const rule = () => {
    doc.setDrawColor(160)
    doc.setLineWidth(0.15)
    doc.setLineDashPattern([0.6, 0.6], 0)
    doc.line(m, y, right, y)
    doc.setLineDashPattern([], 0)
    y += 3.2
  }

  // ── Logo (centred). Kept small with clear space below so the company
  //    name's ascenders never touch it.
  if (settings.logoDataUrl) {
    try {
      const size = width >= 80 ? 13 : 10
      doc.addImage(settings.logoDataUrl, 'PNG', width / 2 - size / 2, y, size, size)
      y += size + 6
    } catch { /* skip broken logo */ }
  }

  // ── Company name (centred, wrapped)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(width >= 80 ? 13 : 11)
  doc.setTextColor(...DARK)
  ;(doc.splitTextToSize(settings.companyName, width - 2 * m) as string[]).forEach((l) => {
    doc.text(l, width / 2, y, { align: 'center' }); y += 5.5
  })

  if (settings.tagline) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY_TXT)
    ;(doc.splitTextToSize(settings.tagline, width - 2 * m) as string[]).forEach((l) => {
      doc.text(l, width / 2, y, { align: 'center' }); y += 3.6
    })
  }
  y += 1.5

  // ── Document title (brand colour)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...primary)
  doc.text(data.title, width / 2, y, { align: 'center' })
  y += 4
  rule()

  // ── Meta rows (label left, value right)
  const meta = (label: string, value: string) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY_TXT)
    doc.text(label, m, y)
    doc.setTextColor(...DARK)
    ;(doc.splitTextToSize(value, width - 2 * m - 22) as string[]).forEach((l, i) => {
      doc.text(l, right, y + i * 3.4, { align: 'right' })
    })
    y += 3.8
  }
  meta(`${data.refLabel}:`, data.refValue)
  meta('Date & Time:', data.date)
  if (data.customerName) meta('Customer:', data.customerName)
  if (data.customerPhone) meta('Phone:', data.customerPhone)
  rule()

  // ── Items: name on its own line(s), then "qty x price ........ amount"
  data.items.forEach((it) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...DARK)
    ;(doc.splitTextToSize(it.name, width - 2 * m) as string[]).forEach((l) => {
      doc.text(l, m, y); y += 3.6
    })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...GRAY_TXT)
    const qtyText = `${it.qty}${it.stockUnit ? ' ' + it.stockUnit : ''} x ${it.unitPrice.toLocaleString()}`
    doc.text(qtyText, m, y)
    doc.setTextColor(...DARK)
    doc.text((it.qty * it.unitPrice).toLocaleString(), right, y, { align: 'right' })
    y += 4.4
  })
  rule()

  // ── Total
  const units = data.items.reduce((s, i) => s + i.qty, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...DARK)
  doc.text('TOTAL', m, y)
  doc.text(`${cur} ${data.total.toLocaleString()}`, right, y, { align: 'right' })
  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY_TXT)
  doc.text(`Items: ${units}`, m, y)
  y += 4.5

  // ── Note / terms
  if (data.note) {
    rule()
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...DARK)
    ;(doc.splitTextToSize(data.note, width - 2 * m) as string[]).forEach((l) => {
      doc.text(l, m, y); y += 3.6
    })
    y += 0.5
  }

  y = drawPaymentDetailsThermal(doc, settings, y, m, width, rule)

  // ── Footer
  rule()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY_TXT)
  ;(doc.splitTextToSize(settings.footerText, width - 2 * m) as string[]).forEach((l) => {
    doc.text(l, width / 2, y, { align: 'center' }); y += 3.6
  })
  y += 4

  return y
}

/** Build a thermal-roll PDF sized to its content height. */
function buildThermalPDF(data: ThermalDoc, settings: PDFSettings, width: number): jsPDF {
  // Pass 1 — measure on a tall scratch page.
  const scratch = new jsPDF({ unit: 'mm', format: [width, 2000] })
  const height  = drawThermal(scratch, data, settings, width)
  // Pass 2 — render onto a page sized exactly to the content.
  const doc = new jsPDF({ unit: 'mm', format: [width, Math.max(height, 40)] })
  drawThermal(doc, data, settings, width)
  return doc
}

// ─── Receipt ──────────────────────────────────────────────────────────────────

export interface ReceiptItem {
  name: string
  sku?: string
  qty: number
  unitPrice: number
}

export interface ReceiptData {
  orderId: string
  items: ReceiptItem[]
  total: number
  date: string
}

export function generateReceiptPDF(data: ReceiptData): jsPDF {
  const settings = loadSettings()
  const primary  = hexToRgb(settings.primaryColor)
  const cur      = settings.currency

  // Thermal roll formats use a dedicated single-column layout.
  const title = settings.receiptTitle?.trim() || 'RECEIPT'

  const rollWidth = receiptWidthMm(settings.receiptFormat)
  if (rollWidth) {
    return buildThermalPDF({
      title,
      refLabel: 'Order',
      refValue: data.orderId,
      date: data.date,
      items: data.items,
      total: data.total,
    }, settings, rollWidth)
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  let y = drawHeader(
    doc,
    settings.companyName,
    `${title} • ${data.date}`,
    settings,
  )

  // ── Order reference
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY_TXT)
  doc.text(`Order: ${data.orderId}`, MARGIN, y)
  y += 10

  // ── Summary KPI row
  const units = data.items.reduce((s, i) => s + i.qty, 0)
  y = drawSectionHeader(doc, 'Summary', y, primary)
  y = drawKPIRow(doc, [
    { label: 'Date & Time',    value: data.date },
    { label: 'Total Items',    value: String(units) },
    { label: `Total (${cur})`, value: `${cur} ${data.total.toLocaleString()}` },
  ], y)
  y += 4

  // ── Line items table
  y = drawSectionHeader(doc, 'Items', y, primary)
  autoTable(doc, {
    startY: y,
    head: [['Product', 'SKU', 'Qty', `Unit Price (${cur})`, `Amount (${cur})`]],
    body: data.items.map((i) => [
      i.name,
      i.sku ?? '—',
      String(i.qty),
      i.unitPrice.toLocaleString(),
      (i.qty * i.unitPrice).toLocaleString(),
    ]),
    foot: [['', '', '', 'TOTAL', `${cur} ${data.total.toLocaleString()}`]],
    footStyles: { fontStyle: 'bold', fillColor: primary, textColor: WHITE },
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })

  const tableEnd = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
  drawPaymentDetailsA4(doc, settings, tableEnd + 10, primary)

  addFooters(doc, settings)
  return doc
}

// ─── Close of Business Report ─────────────────────────────────────────────────

export interface COBReportRow {
  name: string
  sku: string
  specification?: string
  stockUnit?: string
  category: string
  sold: number
  stocked: number
  listRevenue: number
  revenue: number   // actual (negotiated) revenue
  netStock: number
}

export interface MissedSaleRow {
  productName: string
  count: number
  reasons: string // human-readable summary
}

export interface ABCSummaryRow {
  className: 'A' | 'B' | 'C'
  label: string          // 'Fast movers' | 'Medium movers' | 'Slow movers'
  products: number
  revenue: number
  revenueShare: number   // 0..1
}

export interface SlowMoverRow {
  name: string
  sku: string
  sold: number
  revenue: number
  lastSale: string       // 'Today' | 'Never sold' | '3 days ago'
}

export interface ABCAnalysis {
  summary: ABCSummaryRow[]      // A, B, C overview
  slowMovers: SlowMoverRow[]    // capped action list
  slowMoverTotal: number        // full count, for "showing X of Y"
}

export interface COBReportData {
  dateLabel: string
  revenue: number       // actual revenue
  listRevenue?: number  // at-list revenue (for discount section)
  unitsSold: number
  lowStockCount: number
  grossMargin?: number
  rows: COBReportRow[]
  lowStockItems: Array<{ name: string; sku: string; stock: number }>
  missedSales?: MissedSaleRow[]
  abc?: ABCAnalysis     // stock movement analysis (ABC)
}

/** Stock Movement (ABC) section — summary + slow-mover action list. Returns y after. */
function drawStockMovement(doc: jsPDF, abc: ABCAnalysis, y: number, primary: RGB, cur: string): number {
  y = drawSectionHeader(doc, 'Stock Movement Analysis (ABC)', y, primary)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...GRAY_TXT)
  const legend = 'A = top 70% of revenue (fast movers)    B = next 20% (medium movers)    C = bottom 10% + zero sales (slow movers)'
  const legendLines = doc.splitTextToSize(legend, CONTENT - 10) as string[]
  doc.text(legendLines, MARGIN + 5, y)
  y += legendLines.length * 4 + 2

  autoTable(doc, {
    startY: y,
    head: [['Class', 'Movers', 'Products', `Revenue (${cur})`, '% of Revenue']],
    body: abc.summary.map((s) => [
      s.className,
      s.label,
      String(s.products),
      s.revenue.toLocaleString(),
      `${(s.revenueShare * 100).toFixed(1)}%`,
    ]),
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 0: { fontStyle: 'bold' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // ── Slow movers needing attention. Deliberately VIOLET, not amber —
  // "dead/cold stock not moving" is the opposite problem to the amber
  // "Low Stock Alert" (running out), so they must not share a colour.
  if (abc.slowMovers.length > 0) {
    const violet: RGB = [124, 58, 237]
    const violetBg: RGB = [245, 243, 255]
    doc.setFillColor(...violetBg)
    doc.roundedRect(MARGIN, y, CONTENT, 10, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...violet)
    const showing = abc.slowMoverTotal > abc.slowMovers.length
      ? `Slow Movers - Overstocked / Not Selling  (showing ${abc.slowMovers.length} of ${abc.slowMoverTotal})`
      : 'Slow Movers - Overstocked / Not Selling'
    doc.text(showing, MARGIN + 5, y + 6.8)
    y += 14

    autoTable(doc, {
      startY: y,
      head: [['Product', 'SKU', 'Sold', `Revenue (${cur})`, 'Last Sale']],
      body: abc.slowMovers.map((r) => [
        r.name,
        r.sku,
        String(r.sold),
        r.revenue.toLocaleString(),
        r.lastSale,
      ]),
      headStyles: { fillColor: violet, textColor: WHITE, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      alternateRowStyles: { fillColor: [250, 250, 252] },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  }

  return y
}

export function generateCOBReportPDF(data: COBReportData, settingsOverride?: PDFSettings): jsPDF {
  const settings = settingsOverride ?? loadSettings()
  const primary  = hexToRgb(settings.primaryColor)
  const cur      = settings.currency
  const doc      = new jsPDF({ unit: 'mm', format: 'a4' })

  let y = drawHeader(
    doc,
    settings.companyName,
    `Close of Business Report • ${data.dateLabel}`,
    settings,
  )

  // ── Key Performance Indicators section
  y = drawSectionHeader(doc, 'Key Performance Indicators', y, primary)
  const discountGiven = data.listRevenue != null ? data.listRevenue - data.revenue : 0
  const kpis: Array<{ label: string; value: string }> = [
    { label: 'Actual Revenue',  value: `${cur} ${data.revenue.toLocaleString()}` },
    { label: 'Units Sold',      value: data.unitsSold.toLocaleString() },
    { label: 'Low Stock Items', value: String(data.lowStockCount) },
  ]
  if (data.listRevenue != null && discountGiven > 0) {
    kpis.push({ label: 'Discount Given', value: `−${cur} ${discountGiven.toLocaleString()}` })
  } else if (data.grossMargin !== undefined) {
    kpis.push({ label: 'Gross Margin', value: `${data.grossMargin.toFixed(1)}%` })
  }
  y = drawKPIRow(doc, kpis, y)
  y += 6

  // ── Sales Summary narrative
  y = drawSectionHeader(doc, 'Sales Summary', y, primary)
  const noActivity = data.rows.length === 0
  const summaryText = noActivity
    ? 'No transactions were recorded for this period.'
    : `${data.unitsSold.toLocaleString()} unit${data.unitsSold !== 1 ? 's' : ''} were sold across ${data.rows.length} product${data.rows.length !== 1 ? 's' : ''}, generating ${cur} ${data.revenue.toLocaleString()} in revenue.` +
      (data.lowStockCount > 0
        ? ` ${data.lowStockCount} item${data.lowStockCount !== 1 ? 's are' : ' is'} running low and require attention.`
        : ' All products are sufficiently stocked.')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  const lines = doc.splitTextToSize(summaryText, CONTENT - 10) as string[]
  doc.text(lines, MARGIN + 5, y)
  y += lines.length * 5 + 6

  // ── Product Breakdown table
  y = drawSectionHeader(doc, 'Product Breakdown', y, primary)
  const showBothPrices = data.rows.some((r) => r.listRevenue !== r.revenue)
  const totSold        = data.rows.reduce((s, r) => s + r.sold, 0)
  const totRevenue     = data.rows.reduce((s, r) => s + r.revenue, 0)
  const totListRevenue = data.rows.reduce((s, r) => s + (r.listRevenue ?? r.revenue), 0)
  const totalRow = showBothPrices
    ? [{ content: 'TOTAL', colSpan: 4, styles: { halign: 'right' as const } }, String(totSold), '', totListRevenue.toLocaleString(), totRevenue.toLocaleString(), '']
    : [{ content: 'TOTAL', colSpan: 4, styles: { halign: 'right' as const } }, String(totSold), '', totRevenue.toLocaleString(), '']
  autoTable(doc, {
    startY: y,
    head: [showBothPrices
      ? ['Product', 'Spec', 'SKU', 'Category', 'Sold', 'Stocked', `List Rev (${cur})`, `Actual Rev (${cur})`, 'Net Stock']
      : ['Product', 'Spec', 'SKU', 'Category', 'Sold', 'Stocked', `Revenue (${cur})`, 'Net Stock']
    ],
    foot: [totalRow],
    footStyles: { fillColor: GRAY_BG, textColor: DARK, fontStyle: 'bold', fontSize: 8 },
    showFoot: 'lastPage',
    body: data.rows.map((r) => {
      const base = [
        r.name,
        r.specification ?? '—',
        r.sku,
        r.category,
        `${r.sold}${r.stockUnit ? ' ' + r.stockUnit : ''}`,
        `${r.stocked}${r.stockUnit ? ' ' + r.stockUnit : ''}`,
      ]
      const netStockCell = {
        content: r.netStock,
        styles: {
          textColor: r.netStock < 5 ? ([180, 83, 9] as RGB) : DARK,
          fontStyle: r.netStock < 5 ? ('bold' as const) : ('normal' as const),
        },
      }
      if (showBothPrices) {
        return [...base, r.listRevenue.toLocaleString(), r.revenue.toLocaleString(), netStockCell]
      }
      return [...base, r.revenue.toLocaleString(), netStockCell]
    }),
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: showBothPrices
      ? { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } }
      : { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: MARGIN, right: MARGIN },
  })

  // ── Stock Movement Analysis (ABC) — follows the breakdown
  if (data.abc && data.abc.summary.length > 0) {
    let smy = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
    const pageH = doc.internal.pageSize.getHeight()
    if (smy > pageH - 50) { doc.addPage(); smy = MARGIN }
    drawStockMovement(doc, data.abc, smy, primary, cur)
  }

  // ── Low Stock Alert section (if any)
  if (data.lowStockItems.length > 0) {
    const amber: RGB = [217, 119, 6]
    const amberBg: RGB = [255, 251, 235]
    const tableEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    let lsy = tableEndY + 8

    // Section header in amber
    doc.setFillColor(...amberBg)
    doc.roundedRect(MARGIN, lsy, CONTENT, 10, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...amber)
    doc.text('⚠  Low Stock Alert', MARGIN + 5, lsy + 6.8)
    lsy += 14

    autoTable(doc, {
      startY: lsy,
      head: [['Product', 'SKU', 'Current Stock']],
      body: data.lowStockItems.map((i) => [i.name, i.sku, i.stock]),
      headStyles: { fillColor: amber, textColor: WHITE, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [180, 83, 9] as RGB },
      margin: { left: MARGIN, right: MARGIN },
    })
  }

  // ── Missed Sales / Action Points
  if (data.missedSales && data.missedSales.length > 0) {
    const orange: RGB = [234, 88, 12]
    const orangeBg: RGB = [255, 237, 213]
    const prevFinalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable?.finalY
    let msy = (prevFinalY ?? 250) + 10

    doc.setFillColor(...orangeBg)
    doc.roundedRect(MARGIN, msy, CONTENT, 10, 1.5, 1.5, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...orange)
    doc.text('Missed Sales - Action Points', MARGIN + 5, msy + 6.8)
    msy += 14

    autoTable(doc, {
      startY: msy,
      head: [['Product', 'Times Missed', 'Reasons']],
      body: data.missedSales.map((r) => [r.productName, r.count, r.reasons]),
      headStyles: { fillColor: orange, textColor: WHITE, fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: DARK },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    })
  }

  addFooters(doc, settings)
  return doc
}

// ─── Stock Count Report ────────────────────────────────────────────────────────

export interface StockCountReportRow {
  name: string
  sku: string
  expected: number
  counted: number
  delta: number
}

export interface StockCountReportData {
  branchName: string
  submittedAt: string
  submittedBy?: string
  rows: StockCountReportRow[]
}

export function generateStockCountReportPDF(
  data: StockCountReportData,
  settingsOverride?: PDFSettings,
): jsPDF {
  const settings = settingsOverride ?? loadSettings()
  const primary  = hexToRgb(settings.primaryColor)
  const doc      = new jsPDF({ unit: 'mm', format: 'a4' })

  const subtitle = `Stock Count Report • ${data.branchName} • ${data.submittedAt}` +
    (data.submittedBy ? ` • ${data.submittedBy}` : '')
  let y = drawHeader(doc, settings.companyName, subtitle, settings)

  const matched = data.rows.filter((r) => r.delta === 0)
  const short   = data.rows.filter((r) => r.delta < 0)
  const over    = data.rows.filter((r) => r.delta > 0)
  const netVariance = data.rows.reduce((s, r) => s + r.delta, 0)

  y = drawSectionHeader(doc, 'Summary', y, primary)
  y = drawKPIRow(doc, [
    { label: 'Items Counted', value: String(data.rows.length) },
    { label: 'Matched',       value: String(matched.length) },
    { label: 'Short',         value: String(short.length) },
    { label: 'Over',          value: String(over.length) },
  ], y)
  y += 6

  y = drawSectionHeader(doc, 'Counted Items', y, primary)
  const green: RGB = [21, 128, 61]
  const red: RGB   = [185, 28, 28]

  autoTable(doc, {
    startY: y,
    head: [['Product', 'SKU', 'Expected', 'Counted', 'Variance', 'Status']],
    body: data.rows.map((r) => {
      const color = r.delta === 0 ? GRAY_TXT : r.delta < 0 ? red : green
      const status = r.delta === 0 ? 'Match' : r.delta < 0 ? 'Short' : 'Over'
      return [
        r.name,
        r.sku,
        String(r.expected),
        String(r.counted),
        {
          content: (r.delta > 0 ? '+' : '') + String(r.delta),
          styles: { textColor: color, fontStyle: 'bold' as const },
        },
        { content: status, styles: { textColor: color } },
      ]
    }),
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: MARGIN, right: MARGIN },
  })

  const finalY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...DARK)
  doc.text(`Net variance: ${netVariance > 0 ? '+' : ''}${netVariance} units`, MARGIN, finalY)

  addFooters(doc, settings)
  return doc
}
