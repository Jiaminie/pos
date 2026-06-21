import { prisma } from "@/lib/server/db";
import { Resend } from "resend";

const LOW_STOCK_THRESHOLD = 5;

export async function POST() {
  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const transactions = await prisma.inventoryTransaction.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { product: true },
    });

    const incidents = await prisma.incident.findMany({
      where: { createdAt: { gte: start, lte: end } },
    });

    type ProductSummary = {
      name: string;
      sku: string;
      sales: number;
      purchases: number;
      listRevenue: number;
      actualRevenue: number;
      discountGiven: number;
    };

    const byProduct = new Map<string, ProductSummary>();

    for (const tx of transactions) {
      if (!byProduct.has(tx.productId)) {
        byProduct.set(tx.productId, {
          name: tx.product.name,
          sku: tx.product.sku,
          sales: 0,
          purchases: 0,
          listRevenue: 0,
          actualRevenue: 0,
          discountGiven: 0,
        });
      }
      const s = byProduct.get(tx.productId)!;
      if (tx.type === "SALE") {
        const listPrice = Number(tx.product.sellingPrice);
        const soldPrice = Number(tx.unitPrice ?? tx.product.sellingPrice);
        const qty = Number(tx.quantity);
        s.sales += qty;
        s.listRevenue += qty * listPrice;
        s.actualRevenue += qty * soldPrice;
        s.discountGiven += qty * (listPrice - soldPrice);
      } else if (tx.type === "PURCHASE") {
        s.purchases += Number(tx.quantity);
      }
    }

    // Running stock from all-time transactions
    const allTime = await prisma.inventoryTransaction.groupBy({
      by: ["productId", "type"],
      _sum: { quantity: true },
    });

    const stockByProduct = new Map<string, number>();
    for (const row of allTime) {
      const prev = stockByProduct.get(row.productId) ?? 0;
      const qty = Number(row._sum.quantity ?? 0);
      if (row.type === "PURCHASE" || row.type === "RETURN") {
        stockByProduct.set(row.productId, prev + qty);
      } else if (row.type === "SALE" || row.type === "ADJUSTMENT") {
        stockByProduct.set(row.productId, prev - qty);
      }
    }

    const allProducts = await prisma.product.findMany();
    const lowStock = allProducts.filter(
      (p) => (stockByProduct.get(p.id) ?? 0) < LOW_STOCK_THRESHOLD
    );

    // Incidents heatspots
    type IncidentSummary = { productName: string; count: number; reasons: Record<string, number> };
    const incidentMap = new Map<string, IncidentSummary>();
    for (const inc of incidents) {
      const key = inc.productId ?? `__free__${inc.productName}`;
      if (!incidentMap.has(key)) {
        incidentMap.set(key, { productName: inc.productName, count: 0, reasons: {} });
      }
      const s = incidentMap.get(key)!;
      s.count++;
      s.reasons[inc.reason] = (s.reasons[inc.reason] ?? 0) + 1;
    }
    const heatspots = [...incidentMap.values()].sort((a, b) => b.count - a.count);

    const date = start.toDateString();
    const totalDiscount = [...byProduct.values()].reduce((s, r) => s + r.discountGiven, 0);

    const summaryRows = [...byProduct.entries()]
      .map(([, s]) =>
        `<tr>
          <td>${s.name}</td><td>${s.sku}</td><td>${s.sales}</td><td>${s.purchases}</td>
          <td>KES ${s.listRevenue.toFixed(2)}</td>
          <td>KES ${s.actualRevenue.toFixed(2)}</td>
          <td style="color:${s.discountGiven > 0 ? '#d97706' : 'inherit'}">
            ${s.discountGiven > 0 ? `−KES ${s.discountGiven.toFixed(2)}` : '—'}
          </td>
        </tr>`
      )
      .join("");

    const lowStockRows = lowStock
      .map((p) => `<tr><td>${p.name}</td><td>${p.sku}</td><td>${stockByProduct.get(p.id) ?? 0}</td></tr>`)
      .join("");

    const heatspotRows = heatspots
      .map((h) => {
        const reasons = Object.entries(h.reasons)
          .map(([r, c]) => `${r.replace(/_/g, ' ')} (${c})`)
          .join(', ');
        return `<tr><td>${h.productName}</td><td>${h.count}</td><td>${reasons}</td></tr>`;
      })
      .join("");

    const html = `
      <h2>Daily Inventory Report — ${date}</h2>

      <h3>Sales Summary</h3>
      <table border="1" cellpadding="4">
        <thead>
          <tr>
            <th>Product</th><th>SKU</th><th>Units Sold</th><th>Units Purchased</th>
            <th>List Revenue</th><th>Actual Revenue</th><th>Discount Given</th>
          </tr>
        </thead>
        <tbody>${summaryRows || "<tr><td colspan='7'>No transactions today</td></tr>"}</tbody>
        ${byProduct.size > 0 ? `<tfoot><tr><td colspan="6"><strong>Total discount given today</strong></td><td><strong>−KES ${totalDiscount.toFixed(2)}</strong></td></tr></tfoot>` : ''}
      </table>

      ${lowStock.length > 0
        ? `<h3>⚠ Low Stock Alert (below ${LOW_STOCK_THRESHOLD} units)</h3>
           <table border="1" cellpadding="4">
             <thead><tr><th>Product</th><th>SKU</th><th>Current Stock</th></tr></thead>
             <tbody>${lowStockRows}</tbody>
           </table>`
        : "<p>✓ All products are sufficiently stocked.</p>"}

      ${heatspots.length > 0
        ? `<h3>🔥 Missed Sales — Action Points</h3>
           <p>These items were requested by customers but not sold today. Investigate and restock/reprice as needed.</p>
           <table border="1" cellpadding="4">
             <thead><tr><th>Product</th><th>Times Missed</th><th>Reasons</th></tr></thead>
             <tbody>${heatspotRows}</tbody>
           </table>`
        : ""}
    `;

    await resend.emails.send({
      from: "POS Reports <reports@resend.dev>",
      to: process.env.REPORT_EMAIL!,
      subject: `Daily Inventory Report — ${date}`,
      html,
    });

    return Response.json({ data: { sent: true, date }, error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ data: null, error: message }, { status: 500 });
  }
}
