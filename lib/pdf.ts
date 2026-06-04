import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { loadSettings, hexToRgb, type PDFSettings } from './settings'

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
  customerEmail?: string
  note?: string
  items: QuotationItem[]
  date: string
  quoteRef: string
}

export function generateQuotationPDF(data: QuotationData): jsPDF {
  const settings = loadSettings()
  const primary  = hexToRgb(settings.primaryColor)
  const doc      = new jsPDF({ unit: 'mm', format: 'a4' })
  const cur      = settings.currency

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
  if (data.customerEmail) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY_TXT)
    doc.text(data.customerEmail, MARGIN + 5, y)
    y += 6
  }
  y += 4

  // ── Summary KPI row
  const total   = data.items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const units   = data.items.reduce((s, i) => s + i.qty, 0)
  y = drawSectionHeader(doc, 'Summary', y, primary)
  y = drawKPIRow(doc, [
    { label: 'Date',       value: data.date },
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
  }

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
  revenue: number
  netStock: number
}

export interface COBReportData {
  dateLabel: string
  revenue: number
  unitsSold: number
  lowStockCount: number
  grossMargin?: number  // optional, percentage 0-100
  rows: COBReportRow[]
  lowStockItems: Array<{ name: string; sku: string; stock: number }>
}

export function generateCOBReportPDF(data: COBReportData): jsPDF {
  const settings = loadSettings()
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
  const kpis: Array<{ label: string; value: string }> = [
    { label: 'Revenue',        value: `${cur} ${data.revenue.toLocaleString()}` },
    { label: 'Units Sold',     value: data.unitsSold.toLocaleString() },
    { label: 'Low Stock Items',value: String(data.lowStockCount) },
  ]
  if (data.grossMargin !== undefined) {
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
  autoTable(doc, {
    startY: y,
    head: [['Product', 'Spec', 'SKU', 'Category', 'Sold', 'Stocked', `Revenue (${cur})`, 'Net Stock']],
    body: data.rows.map((r) => [
      r.name,
      r.specification ?? '—',
      r.sku,
      r.category,
      `${r.sold}${r.stockUnit ? ' ' + r.stockUnit : ''}`,
      `${r.stocked}${r.stockUnit ? ' ' + r.stockUnit : ''}`,
      r.revenue.toLocaleString(),
      {
        content: r.netStock,
        styles: {
          textColor: r.netStock < 5 ? ([180, 83, 9] as RGB) : DARK,
          fontStyle: r.netStock < 5 ? ('bold' as const) : ('normal' as const),
        },
      },
    ]),
    headStyles: { fillColor: primary, textColor: WHITE, fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    margin: { left: MARGIN, right: MARGIN },
  })

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

  addFooters(doc, settings)
  return doc
}
