import { Resend } from 'resend'

/**
 * Owner-facing fraud/anomaly alerts. Best-effort: never throws, so a missing
 * API key or mail failure can't break the action that triggered the alert.
 */
async function sendOwnerAlert(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.REPORT_EMAIL
  if (!apiKey || !to) {
    console.warn('[alerts] RESEND_API_KEY or REPORT_EMAIL not set — skipping', subject)
    return
  }
  try {
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: 'POS Alerts <reports@resend.dev>',
      to,
      subject,
      html: shell(html),
    })
  } catch (err) {
    console.error('[alerts] failed to send', subject, err)
  }
}

function shell(body: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#b91c1c;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">🚩 POS Activity Alert</h2>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:16px 24px;border-radius:0 0 8px 8px">
      ${body}
    </div>
  </div>`
}

const money = (n: number) => `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export async function alertSaleVoided(opts: {
  saleId: string
  amount: number
  branchName: string
  cashierName: string
  approverName: string
  reason?: string | null
}): Promise<void> {
  await sendOwnerAlert(
    `Sale voided — ${money(opts.amount)} at ${opts.branchName}`,
    `<p>A completed sale was <strong>voided / refunded</strong>.</p>
     <table style="font-size:14px;border-collapse:collapse">
       <tr><td style="padding:4px 12px;color:#6b7280">Amount</td><td style="padding:4px 12px;font-weight:bold">${money(opts.amount)}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Branch</td><td style="padding:4px 12px">${opts.branchName}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Initiated by</td><td style="padding:4px 12px">${opts.cashierName}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Approved by</td><td style="padding:4px 12px">${opts.approverName}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Reason</td><td style="padding:4px 12px">${opts.reason ?? '—'}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Sale ID</td><td style="padding:4px 12px;font-family:monospace">${opts.saleId}</td></tr>
     </table>`,
  )
}

export async function alertHighDiscount(opts: {
  saleId: string
  discount: number
  total: number
  branchName: string
  cashierName: string
}): Promise<void> {
  const pct = opts.total > 0 ? Math.round((opts.discount / (opts.total + opts.discount)) * 100) : 0
  await sendOwnerAlert(
    `Large discount — ${money(opts.discount)} (${pct}%) at ${opts.branchName}`,
    `<p>A sale was completed with a <strong>large discount</strong>.</p>
     <table style="font-size:14px;border-collapse:collapse">
       <tr><td style="padding:4px 12px;color:#6b7280">Discount</td><td style="padding:4px 12px;font-weight:bold">${money(opts.discount)} (${pct}%)</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Sale total</td><td style="padding:4px 12px">${money(opts.total)}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Branch</td><td style="padding:4px 12px">${opts.branchName}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Cashier</td><td style="padding:4px 12px">${opts.cashierName}</td></tr>
     </table>`,
  )
}

export async function alertOfflineBacklog(opts: {
  branchName: string
  count: number
  value: number
}): Promise<void> {
  await sendOwnerAlert(
    `Offline backlog — ${opts.count} unsynced sales at ${opts.branchName}`,
    `<p>A device has a growing <strong>offline backlog</strong> of sales not yet synced to the server.</p>
     <table style="font-size:14px;border-collapse:collapse">
       <tr><td style="padding:4px 12px;color:#6b7280">Unsynced sales</td><td style="padding:4px 12px;font-weight:bold">${opts.count}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Value</td><td style="padding:4px 12px">${money(opts.value)}</td></tr>
       <tr><td style="padding:4px 12px;color:#6b7280">Branch</td><td style="padding:4px 12px">${opts.branchName}</td></tr>
     </table>
     <p style="color:#6b7280;font-size:12px">Sales continue normally offline; this is a heads-up to reconcile once the device reconnects.</p>`,
  )
}
