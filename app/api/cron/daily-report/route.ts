import { prisma } from '@/lib/server/db'
import { Resend } from 'resend'
import { generateCOBReportPDF } from '@/lib/pdf'
import type { COBReportData, COBReportRow, MissedSaleRow, ABCAnalysis } from '@/lib/pdf'
import type { PDFSettings } from '@/lib/settings'
import { parseReceiptFormat, parsePosLookupMode } from '@/lib/settings'

const LOW_STOCK_THRESHOLD = 5

export async function POST() {
  try {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setHours(23, 59, 59, 999)

    // ── Load store settings from DB for PDF branding + email config
    const dbSettings = await prisma.storeSettings.findFirst()

    const resendKey = dbSettings?.resendApiKey || process.env.RESEND_API_KEY
    const toEmail   = dbSettings?.reportEmail  || process.env.REPORT_EMAIL
    if (!resendKey || !toEmail) {
      return Response.json({ data: null, error: 'Resend API key or report email not configured' }, { status: 400 })
    }

    const fromAddress = dbSettings?.fromEmail
      ? `${dbSettings.companyName ?? 'POS'} <${dbSettings.fromEmail}>`
      : `${dbSettings?.companyName ?? 'POS'} Reports <reports@resend.dev>`

    // Re-initialise Resend with the DB key (overrides the one created at top of function)
    const resendClient = new Resend(resendKey)

    const settings: PDFSettings = {
      companyName:     dbSettings?.companyName    ?? 'My Business',
      tagline:         dbSettings?.tagline        ?? '',
      logoDataUrl:     dbSettings?.logoDataUrl    ?? '',
      primaryColor:    dbSettings?.primaryColor   ?? '#2563eb',
      currency:        dbSettings?.currency       ?? 'KES',
      footerText:      dbSettings?.footerText     ?? 'Thank you for your business.',
      minMarkupPercent: Number(dbSettings?.minMarkupPercent ?? 150),
      posLookupMode:   parsePosLookupMode(dbSettings?.posLookupMode),
      receiptFormat:   parseReceiptFormat(dbSettings?.receiptFormat),
      receiptTitle:    dbSettings?.receiptTitle   ?? 'RECEIPT',
    }
    const cur = settings.currency

    // ── Today's transactions
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { product: true },
    })

    // ── All-time stock levels
    const allTime = await prisma.inventoryTransaction.groupBy({
      by: ['productId', 'type'],
      _sum: { quantity: true },
    })
    const stockByProduct = new Map<string, number>()
    for (const row of allTime) {
      const prev = stockByProduct.get(row.productId) ?? 0
      const qty  = Number(row._sum.quantity ?? 0)
      if (row.type === 'PURCHASE' || row.type === 'RETURN') {
        stockByProduct.set(row.productId, prev + qty)
      } else if (row.type === 'SALE' || row.type === 'ADJUSTMENT') {
        stockByProduct.set(row.productId, prev - qty)
      }
    }

    // ── All products (for low-stock + ABC zero-sale classification)
    const allProducts = await prisma.product.findMany()

    // ── Build today's per-product summary
    const sales   = transactions.filter((t) => t.type === 'SALE')
    const stockIns = transactions.filter((t) => t.type === 'PURCHASE')

    const activityIds = Array.from(
      new Set([...sales.map((t) => t.productId), ...stockIns.map((t) => t.productId)])
    )

    const round2 = (n: number) => Math.round(n * 100) / 100

    const rows: COBReportRow[] = activityIds.map((id) => {
      const p        = allProducts.find((x) => x.id === id)
      const pSales   = sales.filter((t) => t.productId === id)
      const pStocks  = stockIns.filter((t) => t.productId === id)
      const sold     = round2(pSales.reduce((s, t) => s + Number(t.quantity), 0))
      const stocked  = round2(pStocks.reduce((s, t) => s + Number(t.quantity), 0))
      const listRev  = round2(sold * Number(p?.sellingPrice ?? 0))
      const actRev   = round2(pSales.reduce((s, t) => s + Number(t.unitPrice ?? p?.sellingPrice ?? 0) * Number(t.quantity), 0))
      return {
        name:          p?.name          ?? id,
        sku:           p?.sku           ?? '—',
        specification: p?.specification ?? undefined,
        stockUnit:     p?.stockUnit     ?? undefined,
        category:      p?.category      ?? '—',
        sold,
        stocked,
        listRevenue:   listRev,
        revenue:       actRev,
        netStock:      round2(stockByProduct.get(id) ?? 0),
      }
    })

    const revenue     = round2(rows.reduce((s, r) => s + r.revenue, 0))
    const listRevenue = round2(rows.reduce((s, r) => s + r.listRevenue, 0))
    const unitsSold   = round2(rows.reduce((s, r) => s + r.sold, 0))

    // ── Low stock
    const lowStockItems = allProducts
      .filter((p) => (stockByProduct.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD)
      .map((p) => ({ name: p.name, sku: p.sku, stock: round2(stockByProduct.get(p.id) ?? 0) }))

    // ── Missed sales
    const incidents = await prisma.incident.findMany({
      where: { createdAt: { gte: start, lte: end } },
    })
    const incidentMap = new Map<string, MissedSaleRow>()
    for (const inc of incidents) {
      const key = inc.productId ?? `__free__${inc.productName}`
      if (!incidentMap.has(key)) {
        incidentMap.set(key, { productName: inc.productName, count: 0, reasons: '' })
      }
      const s = incidentMap.get(key)!
      s.count++
    }
    const missedSales: MissedSaleRow[] = [...incidentMap.values()]
      .sort((a, b) => b.count - a.count)
      .map((s) => ({ ...s, reasons: `${s.count} time${s.count !== 1 ? 's' : ''}` }))

    // ── ABC stock movement analysis
    // Use all-time sales for revenue classification (same as the in-app report).
    const allSales = await prisma.inventoryTransaction.findMany({
      where: { type: 'SALE' },
      select: { productId: true, quantity: true, unitPrice: true, product: { select: { sellingPrice: true } } },
    })
    const revenueByProduct = new Map<string, number>()
    for (const t of allSales) {
      const rev = Number(t.unitPrice ?? t.product.sellingPrice ?? 0) * Number(t.quantity)
      revenueByProduct.set(t.productId, (revenueByProduct.get(t.productId) ?? 0) + rev)
    }

    // Most recent sale date per product (for slow-mover "last sale" label)
    const lastSaleRecords = await prisma.inventoryTransaction.findMany({
      where: { type: 'SALE' },
      orderBy: { createdAt: 'desc' },
      select: { productId: true, createdAt: true },
      distinct: ['productId'],
    })
    const lastSaleByProduct = new Map<string, Date>()
    for (const r of lastSaleRecords) lastSaleByProduct.set(r.productId, r.createdAt)

    function daysSince(productId: string): string {
      const last = lastSaleByProduct.get(productId)
      if (!last) return 'Never sold'
      const diff = Math.floor((Date.now() - last.getTime()) / 86_400_000)
      if (diff === 0) return 'Today'
      if (diff === 1) return '1 day ago'
      return `${diff} days ago`
    }

    const totalRev = [...revenueByProduct.values()].reduce((s, v) => s + v, 0)
    const soldProducts = [...revenueByProduct.entries()]
      .map(([id, rev]) => ({ id, rev }))
      .sort((a, b) => b.rev - a.rev)

    let cumRev = 0
    type Classified = { id: string; rev: number; cls: 'A' | 'B' | 'C' }
    const classified: Classified[] = soldProducts.map(({ id, rev }) => {
      cumRev += rev
      const pct = totalRev > 0 ? cumRev / totalRev : 0
      return { id, rev, cls: pct <= 0.7 ? 'A' : pct <= 0.9 ? 'B' : 'C' }
    })

    const aItems = classified.filter((r) => r.cls === 'A')
    const bItems = classified.filter((r) => r.cls === 'B')
    const cItems = classified.filter((r) => r.cls === 'C')
    const aRev   = aItems.reduce((s, r) => s + r.rev, 0)
    const bRev   = bItems.reduce((s, r) => s + r.rev, 0)
    const cRev   = cItems.reduce((s, r) => s + r.rev, 0)

    const soldIds      = new Set(soldProducts.map((r) => r.id))
    const zeroSaleIds  = allProducts.filter((p) => !soldIds.has(p.id)).map((p) => p.id)
    const slowPool     = [...cItems.map((r) => r.id), ...zeroSaleIds]

    const abc: ABCAnalysis = {
      summary: [
        { className: 'A', label: 'Fast movers',   products: aItems.length, revenue: aRev, revenueShare: totalRev > 0 ? aRev / totalRev : 0 },
        { className: 'B', label: 'Medium movers', products: bItems.length, revenue: bRev, revenueShare: totalRev > 0 ? bRev / totalRev : 0 },
        { className: 'C', label: 'Slow movers',   products: cItems.length + zeroSaleIds.length, revenue: cRev, revenueShare: totalRev > 0 ? cRev / totalRev : 0 },
      ],
      slowMovers: slowPool.slice(0, 25).map((id) => {
        const p   = allProducts.find((x) => x.id === id)
        const rev = revenueByProduct.get(id) ?? 0
        const txForProduct = allSales.filter((t) => t.productId === id)
        const sold = round2(txForProduct.reduce((s, t) => s + Number(t.quantity), 0))
        return { name: p?.name ?? id, sku: p?.sku ?? '—', sold, revenue: round2(rev), lastSale: daysSince(id) }
      }),
      slowMoverTotal: slowPool.length,
    }

    // ── Assemble COBReportData
    const dateLabel = start.toLocaleDateString('en-KE', { year: 'numeric', month: 'short', day: 'numeric' })
    const reportData: COBReportData = {
      dateLabel,
      revenue,
      listRevenue,
      unitsSold,
      lowStockCount: lowStockItems.length,
      rows,
      lowStockItems,
      missedSales,
      abc,
    }

    // ── Generate PDF
    const doc        = generateCOBReportPDF(reportData, settings)
    const pdfBuffer  = Buffer.from(doc.output('arraybuffer'))
    const filename   = `cob-report-${start.toISOString().slice(0, 10)}.pdf`

    // ── Send email with PDF attachment
    const noActivity = rows.length === 0
    const htmlBody = `
      <p>Hi,</p>
      <p>Please find attached the <strong>Close of Business Report for ${dateLabel}</strong>.</p>
      ${noActivity
        ? '<p>No transactions were recorded today.</p>'
        : `<p>${unitsSold} unit${unitsSold !== 1 ? 's' : ''} sold &nbsp;·&nbsp; ${cur} ${revenue.toLocaleString('en-KE')} actual revenue &nbsp;·&nbsp; ${lowStockItems.length} item${lowStockItems.length !== 1 ? 's' : ''} running low</p>`
      }
      <p style="color:#6b7280;font-size:12px">This report is generated automatically every evening. Open the PDF for the full breakdown including ABC stock movement analysis.</p>
    `

    await resendClient.emails.send({
      from:        fromAddress,
      to:          toEmail,
      subject:     `COB Report — ${dateLabel}`,
      html:        htmlBody,
      attachments: [{ filename, content: pdfBuffer }],
    })

    return Response.json({ data: { sent: true, date: dateLabel }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
