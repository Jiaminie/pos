import { Resend } from 'resend'
import { LOW_STOCK_THRESHOLD } from '@/lib/stock'
import { requireUser, isAuthUser } from '@/lib/server/auth/guard'

interface LowStockItem {
  name: string
  sku: string
  stock: number
}

export async function POST(req: Request) {
  const user = await requireUser()
  if (!isAuthUser(user)) return user

  const resend = new Resend(process.env.RESEND_API_KEY)
  try {
    const { items, triggeredBy }: { items: LowStockItem[]; triggeredBy?: string[] } = await req.json()
    if (!items?.length) return Response.json({ sent: false, reason: 'no items' })

    const sorted = [...items].sort((a, b) => a.stock - b.stock)
    const triggerLine =
      triggeredBy?.length === 1
        ? `<strong>${triggeredBy[0]}</strong> just crossed the threshold during checkout.`
        : triggeredBy?.length
          ? `<strong>${triggeredBy.slice(0, 3).join(', ')}${triggeredBy.length > 3 ? ` +${triggeredBy.length - 3} more` : ''}</strong> just crossed the threshold during checkout.`
          : 'A checkout just pushed stock below the threshold.'

    const rows = sorted
      .map(
        (i) => `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${i.name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace">${i.sku}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;color:#b45309;font-weight:bold">${i.stock}</td>
        </tr>`
      )
      .join('')

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#b45309;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">⚠ Low Stock Alert</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:16px 24px;border-radius:0 0 8px 8px">
          <p>${triggerLine} Below is the full list of products currently below <strong>${LOW_STOCK_THRESHOLD} units</strong>:</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead>
              <tr style="background:#fef3c7">
                <th style="text-align:left;padding:8px 12px">Product</th>
                <th style="text-align:left;padding:8px 12px">SKU</th>
                <th style="text-align:left;padding:8px 12px">Current Stock</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="color:#6b7280;font-size:12px;margin-top:16px">
            Please restock these items soon to avoid stockouts.
          </p>
        </div>
      </div>
    `

    await resend.emails.send({
      from: 'POS Alerts <reports@resend.dev>',
      to: process.env.REPORT_EMAIL!,
      subject: `⚠ Low Stock Alert — ${items.length} item${items.length > 1 ? 's' : ''} need restocking`,
      html,
    })

    return Response.json({ sent: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ sent: false, error: message }, { status: 500 })
  }
}
