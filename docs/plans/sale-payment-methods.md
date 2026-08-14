# Plan: Sale Payment Methods (Cash / M-Pesa / Bank) + Reconciliation

On approval, this document is written verbatim to `docs/plans/sale-payment-methods.md` (alongside `docs/plans/stock-count.md`, `docs/plans/pos-lookup-modes.md`) as step 0, then implemented. It is written for an agent with no prior context on this conversation.

## Context

Sales record no payment information at all. `model Sale` (`prisma/schema.prisma:90`) stores totals, discounts, and void state; `checkout()` (`app/(ui)/pos/page.tsx:692`) rings the sale straight through on one button press. At close of business there is no way to say how much of the day's takings should be in the drawer, in M-Pesa, or in each bank account — cash-ups are done from memory.

The business takes money four ways: cash, M-Pesa, and two banks (Cooperative and Equity), with more banks possible later. One sale can be split across methods (part cash, topped up with M-Pesa).

## Decisions already taken with the owner — do not re-litigate

| Decision         | Choice                                                                                                        |
|------------------|---------------------------------------------------------------------------------------------------------------|
| Split tenders    | Allowed → separate `sale_payments` table, not a column on `sales`                                             |
| Method           | Fixed enum `CASH / MPESA / BANK`                                                                              |
| Bank identity    | Data, not enum. Picker list lives in `StoreSettings`, seeded `Cooperative Bank,Equity Bank`, plus an "+ Add bank" option where the cashier types a new name |
| Capture point    | Payment sheet opens after pressing Checkout                                                                   |
| Voided sales     | Excluded from the reconciliation breakdown                                                                    |
| Historical sales | No backfill — they surface as an "Unrecorded" row                                                             |
| Deliverables     | Schema + POS capture + payment breakdown in reports + method on receipts                                      |

## Non-goals

shift/Z-read cash counting, till float, change-due tracking beyond an on-screen hint, eTIMS/fiscal fields, per-payment reversal on void (voiding a sale already reverses the whole sale).

## Architecture constraints (read before writing code)

- **Offline-first.** A sale is rung locally into IndexedDB, then drained to the server. `drain()` (`lib/db/salesSyncQueue.ts:60`) does `if (!res.ok) return` — a single rejected sale stalls the entire backlog. Therefore the server must never 400 over payment data; reconcile and accept.
- **Server recomputes the total.** `validateAndBuildSale` (`lib/server/sales.ts:26`) clamps unit prices against the price floor, so the client's total can legitimately differ from the server's. Payments must be reconciled against the server total.
- **Idempotent re-sync.** `createSaleRecord` upserts sale and lines by client-generated id. Payment rows must follow the same pattern (client-generated `crypto.randomUUID()` ids, upsert).
- **Next.js.** This project's Next version differs from common training data — per `AGENTS.md`, consult `node_modules/next/dist/docs/` before using any API you are not certain about. This plan touches only existing route-handler and client-component patterns already in the repo; copy them rather than inventing.
- **Prisma 7** (`@prisma/client ^7.8.0`, `@prisma/adapter-pg`). Migrations here are hand-written SQL files under `prisma/migrations/<timestamp>_<name>/migration.sql`.

## Step 1 — Schema

### 1a. prisma/schema.prisma

Add near the Sale model:

```prisma
enum PaymentMethod {
  CASH
  MPESA
  BANK
}

model SalePayment {
  id        String        @id                       // client-generated (offline-first)
  saleId    String        @map("sale_id")
  method    PaymentMethod
  bankName  String?       @map("bank_name")         // set only when method = BANK
  amount    Decimal
  reference String?                                 // M-Pesa code / bank slip no.
  createdAt DateTime      @default(now()) @map("created_at")

  sale Sale @relation(fields: [saleId], references: [id], onDelete: Cascade)

  @@index([saleId])
  @@map("sale_payments")
}
```

In model Sale, alongside `lines InventoryTransaction[]`:

```prisma
  payments SalePayment[]
```

In model StoreSettings (`prisma/schema.prisma:308`), after `paymentDetails`:

```prisma
  bankOptions String @default("Cooperative Bank,Equity Bank") @map("bank_options")
```

CSV, matching the flat-scalar style of every other settings column.

### 1b. prisma/migrations/20260814120000_add_sale_payments/migration.sql

```sql
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK');

-- CreateTable
CREATE TABLE "sale_payments" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "bank_name" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");

-- AddForeignKey
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "store_settings" ADD COLUMN "bank_options" TEXT NOT NULL DEFAULT 'Cooperative Bank,Equity Bank';
```

Verify the generated types compile with `npx prisma generate` before continuing.

---

## Step 2 — Shared helpers: new `lib/payments.ts`

Both the POS sheet and the API need identical rules, so keep this file free of React and Prisma imports.

```ts
export type PaymentMethod = 'CASH' | 'MPESA' | 'BANK'

export type SalePaymentInput = {
  id: string
  method: PaymentMethod
  bankName?: string | null
  amount: number
  reference?: string | null
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH',  label: 'Cash' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'BANK',  label: 'Bank' },
]

export const DEFAULT_BANK_OPTIONS = ['Cooperative Bank', 'Equity Bank']

/** Display name for a tender — the bank's own name stands in for "Bank". */
export function methodLabel(method: PaymentMethod, bankName?: string | null): string {
  if (method === 'BANK') return bankName?.trim() || 'Bank (unspecified)'
  return method === 'MPESA' ? 'M-Pesa' : 'Cash'
}

/** Stable grouping key for reconciliation reports. */
export function paymentKey(method: PaymentMethod, bankName?: string | null): string {
  return method === 'BANK' ? `BANK:${(bankName ?? '').trim().toLowerCase()}` : method
}

export function parseBankOptions(csv: string | null | undefined): string[] {
  const seen = new Set<string>()
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
}

export function serializeBankOptions(list: string[]): string {
  return parseBankOptions(list.join(',')).join(',')
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Single source of truth for "do these tenders match the sale?".
 *
 * Used by the POS sheet (to enable Confirm) and by the API (to store a
 * consistent set). It never throws and never returns an empty list: an
 * unattributed sale is worse than a mis-attributed one, and rejecting a sale
 * server-side would stall the whole offline backlog (see salesSyncQueue.drain).
 */
export function reconcilePayments(
  payments: SalePaymentInput[] | undefined,
  total: number,
): { payments: SalePaymentInput[]; adjusted: number } {
  const target = round2(total)
  const clean = (payments ?? [])
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0)
    .map((p) => ({
      id: p.id || crypto.randomUUID(),
      method: p.method,
      bankName: p.method === 'BANK' ? (p.bankName?.trim() || null) : null,
      amount: round2(p.amount),
      reference: p.reference?.trim() || null,
    }))

  if (clean.length === 0) {
    return {
      payments: [{ id: crypto.randomUUID(), method: 'CASH', bankName: null, amount: target, reference: null }],
      adjusted: target,
    }
  }

  const sum = round2(clean.reduce((s, p) => s + p.amount, 0))
  const delta = round2(target - sum)
  if (Math.abs(delta) < 0.01) return { payments: clean, adjusted: 0 }

  // Absorb the difference into the largest tender — keeps sum(payments) == total.
  const largest = clean.reduce((a, b) => (b.amount > a.amount ? b : a))
  largest.amount = round2(Math.max(0, largest.amount + delta))
  return { payments: clean, adjusted: delta }
}

/** Outstanding balance for the POS sheet. Negative means change is due. */
export function remainingToPay(payments: SalePaymentInput[], total: number): number {
  const sum = payments.reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0)
  return round2(total - sum)
}
```

---

## Step 3 — Server write path

### 3a. lib/server/sales.ts

```ts
import { reconcilePayments, type SalePaymentInput } from '@/lib/payments'
```

- `SaleInput` gains `payments?: SalePaymentInput[]`.
- At the end of `validateAndBuildSale`, after `total` is computed (line ~92):

```ts
  const reconciled = reconcilePayments(input.payments, total)

  return {
    // …existing fields…
    payments: reconciled.payments,
    paymentAdjustment: reconciled.adjusted,   // non-zero ⇒ client tenders didn't match server total
  }
```

- In `createSaleRecord`, inside the existing `prisma.$transaction`, after the line-item loop and only on first write (`if (!existing)`), so a re-drain never duplicates or resurrects edited tenders:

```ts
    if (!existing) {
      for (const p of built.payments) {
        await tx.salePayment.upsert({
          where: { id: p.id },
          update: {},
          create: {
            id: p.id,
            saleId: sale.id,
            method: p.method,
            bankName: p.bankName,
            amount: p.amount,
            reference: p.reference,
            createdAt: built.createdAt,
          },
        })
      }
    }
```

### 3b. app/api/sales/route.ts

- Destructure `payments` from the body (line 17) and pass it into `validateAndBuildSale`.
- Extend the existing `SALE_CREATE` audit metadata (line 50) — this is the accountability trail for cash handling:

```ts
        metadata: {
          total: built.total,
          discountTotal,
          lines: built.lines.length,
          payments: built.payments.map((p) => ({ method: p.method, bankName: p.bankName, amount: p.amount })),
          ...(built.paymentAdjustment !== 0 && { paymentAdjustment: built.paymentAdjustment }),
        },
```

- Still inside `if (created)`, learn any new bank name (best-effort, non-fatal). This is what makes "+ Add bank" stick for everyone: a cashier lacks `admin.settings` and cannot PATCH settings themselves, so the server does it.

```ts
      const newBanks = built.payments
        .filter((p) => p.method === 'BANK' && p.bankName)
        .map((p) => p.bankName as string)
      if (newBanks.length > 0) {
        try {
          const s = await prisma.storeSettings.findFirst({ where: { organizationId: user.orgId } })
          const merged = serializeBankOptions([...parseBankOptions(s?.bankOptions), ...newBanks])
          if (s && merged !== s.bankOptions) {
            await prisma.storeSettings.update({ where: { id: s.id }, data: { bankOptions: merged } })
          }
        } catch { /* non-fatal: the sale is already committed */ }
      }
```

- Do not add a validation branch that 400s on bad payments. The catch at line 77 maps only floor errors to 400; leave it as is.

### 3c. app/api/settings/route.ts

Add `bankOptions` to the PATCH destructure and to both the update and create objects, normalised through the helper (still gated on `admin.settings`):

```ts
        ...(bankOptions !== undefined && { bankOptions: serializeBankOptions(
          Array.isArray(bankOptions) ? bankOptions : String(bankOptions).split(','),
        ) }),
```

---

## Step 4 — Client storage & settings

### 4a. lib/db/sales.ts

```ts
import type { SalePaymentInput } from '../payments'

export type Sale = {
  // …existing fields…
  /** Tenders that paid for this sale; sums to `total`. */
  payments: SalePaymentInput[]
  lines: SaleLine[]
}
```

These are plain extra properties on the existing `sales` / `salesQueue` object stores — do not bump `DB_VERSION` in `lib/db/idb.ts` (currently 10). Older records simply lack the field; read sites must tolerate `undefined`.

### 4b. lib/settings.ts

- `PDFSettings` gains `bankOptions: string[]`; `DEFAULT_SETTINGS.bankOptions = DEFAULT_BANK_OPTIONS`.
- `loadSettings` — `bankOptions: Array.isArray(parsed.bankOptions) ? parsed.bankOptions : DEFAULT_BANK_OPTIONS`.
- `fetchSettings` — `bankOptions: parseBankOptions(data.bankOptions)` falling back to the default when empty.
- `saveSettings` — send `serializeBankOptions(s.bankOptions)` so the wire format stays CSV.

### 4c. app/(ui)/settings/page.tsx

In the receipt/payment section (next to the "Payment details" textarea at line ~712), add a Bank accounts editor: chips for each entry with an × to remove, plus a text input + Add button. Purely a `set('bankOptions', [...])` list editor — the same `set()` helper the other fields use.

---

## Step 5 — POS checkout + payment sheet

### 5a. app/(ui)/pos/page.tsx

Split the existing `checkout()` (line 692) in two:

```ts
  // Opens the payment sheet. All pre-flight guards stay here so the sheet
  // never appears for a sale that can't be rung.
  function checkout() {
    const auth = getCachedAuthUser()
    const branchId = getMyBranchId()
    if (!auth || !branchId) return toast.error('Not signed in')
    if (cart.some((item) => canSaveItemPrice(item))) {
      return toast.warning('Apply pending line prices before checkout')
    }
    setPayFor(computeCartTotals(cart, cartDiscountApplied, (item) => item.unitPrice))
  }

  // Everything from `const saleId = …` in the old checkout() moves here.
  async function confirmSale(payments: SalePaymentInput[]) { … }
```

- New state: `const [payFor, setPayFor] = useState<CartTotals | null>(null)`.
- The Checkout button (line ~1390) now calls `checkout()` only; `setChecking(true)` moves into `confirmSale`.
- The `Sale` object (line ~728) gains `payments`.
- Receipt state (line 132) becomes `{ orderId; items; totals; payments }`; `setReceipt` at line 762 passes the confirmed tenders.
- `buildReceiptDoc()` (line 808) passes them to `generateReceiptPDF` (see Step 6).
- Show the tenders in the receipt modal body (line ~1451), under `CartTotalsBreakdown`, as `Paid by · Cash 2,000 · M-Pesa 2,500`.

### 5b. New `components/pos/PaymentSheet.tsx`

Radix Dialog, styled like the existing receipt modal (line 1422). Props:

```ts
{
  open: boolean
  total: number
  bankOptions: string[]
  busy: boolean
  onCancel: () => void
  onConfirm: (payments: SalePaymentInput[]) => void
}
```

Behaviour:

- Opens with one tender: CASH for the full total, so the common sale is Confirm (one tap) — the method buttons only matter when it isn't cash.
- Per tender: method buttons `Cash | M-Pesa | Bank`, an amount input, and an optional `Reference` input (M-Pesa code / slip no.). Reference is never required — it must not slow the counter.
- Choosing **Bank** reveals a bank picker built from `bankOptions` plus a trailing "+ Add bank" entry. Selecting it swaps in a text input where the cashier types the bank name; that name is stored on the tender and, on sync, learned into settings (Step 3b).
- "+ Add another method" appends a tender pre-filled with `remainingToPay(...)`; each extra tender has a remove ×.
- A live footer line from `remainingToPay`: `Remaining KSh 1,500` (amber) / `Change KSh 200` (blue) / `Covered` (green).
- Confirm is disabled while `remainingToPay(...) > 0.01`, while `busy`, or while a BANK tender has no bank name. Overpayment (change due) is allowed.
- Escape / backdrop close cancels back to the cart with nothing rung up.
- Keep numeric inputs `inputMode="decimal"` and tap targets ≥44px — the register is used on touch devices (see `docs/plans/device-ui-modes.md`).

---

## Step 6 — Receipts (lib/pdf.ts)

- `ReceiptData` (line 488) gains:

```ts
  payments?: { label: string; amount: number; reference?: string | null }[]
```

- `ThermalDoc` (line 322) gains the same optional field; `generateReceiptPDF` forwards `data.payments` into `buildThermalPDF`.
- Thermal (`drawThermal`, after the TOTAL block at line ~427 and before `drawPaymentDetailsThermal`): a `rule()` then one line per tender — `Paid by: M-Pesa … 2,500`, with the reference on a small grey line beneath when present. Skip the block entirely when `payments` is empty.
- A4 (`generateReceiptPDF`): after the items autoTable, draw a small "Payment" section via the existing `drawSectionHeader` at `tableEnd` + 10, then shift the existing `drawPaymentDetailsA4(...)` call below it.
- The existing `drawPaymentDetailsA4` / `drawPaymentDetailsThermal` helpers print the static till/bank details from settings — unrelated; leave them intact.
- Label strings come from `methodLabel(method, bankName)` — the caller maps, the PDF layer stays dumb.

`app/(ui)/reports/page.tsx` → `reprintReceipt` (line 481) passes `payments` when the local sale record has them, and omits the block for pre-feature sales.

---

## Step 7 — Reports & reconciliation

### 7a. New `app/api/reports/payments/route.ts`

Model it directly on `app/api/reports/discounts/route.ts` — same imports, same `reports.view.org | reports.view.branch | reports.view.own` permission triple, same `branchFilter(user, requestedBranch)`, same from/to handling. A server endpoint is required: the local IDB sales store only holds sales this device rang up, and reconciliation must cover every device in the branch.

```ts
  const sales = await prisma.sale.findMany({
    where: {
      organizationId: user.orgId,
      voidedAt: null,                       // voided sales never count toward takings
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(canOwn && !canOrg && !canBranch ? { cashierId: user.userId } : {}),
      ...dateFilter,
    },
    select: {
      id: true, total: true,
      payments: { select: { method: true, bankName: true, amount: true } },
    },
  })
```

Aggregate with `paymentKey()` into:

```ts
{ data: {
    byMethod: [{ key, label, method, bankName, count, amount }],  // desc by amount
    unrecordedAmount,        // Σ total of sales with zero payment rows (pre-feature history)
    unrecordedCount,
    total,                   // Σ sale totals
    saleCount,
    voidedExcludedCount,     // separate count query, so an odd figure is explainable
  }, error: null }
```

### 7b. app/(ui)/reports/page.tsx

- Fetch it in the same `fetchMe().then(...)` block that loads `discountData` (line ~190), reusing the identical query string, into `paymentData` state.
- Render a "Payment breakdown" card above the Receipts section (line ~877), styled like the discounts card (line 823): one row per method/bank with count, amount, and share of takings; an amber "Unrecorded" row when `unrecordedAmount > 0` (sales rung before this feature); the range label and `voidedExcludedCount` in the header.
- Add a small method chip to each receipt row (line ~919) when the local sale record carries `payments`.

---

## Files touched

| File                                    | Change                                                                     |
|-----------------------------------------|----------------------------------------------------------------------------|
| `prisma/schema.prisma`                  | `PaymentMethod` enum, `SalePayment` model, `Sale.payments`, `StoreSettings.bankOptions` |
| `prisma/migrations/20260814120000_add_sale_payments/migration.sql` | new                                                          |
| `lib/payments.ts`                       | new — shared types, labels, `reconcilePayments`, `remainingToPay`            |
| `lib/server/sales.ts`                   | reconcile + persist tenders in the sale transaction                        |
| `app/api/sales/route.ts`                | accept payments, audit them, learn new bank names                          |
| `app/api/settings/route.ts`             | accept `bankOptions`                                                       |
| `app/api/reports/payments/route.ts`     | new — reconciliation endpoint                                               |
| `lib/db/sales.ts`                       | `payments` on the local `Sale`                                              |
| `lib/settings.ts`                       | `bankOptions` through load / fetch / save                                  |
| `app/(ui)/settings/page.tsx`            | bank list editor                                                            |
| `app/(ui)/pos/page.tsx`                 | `checkout()` → sheet → `confirmSale()`; receipt carries tenders             |
| `components/pos/PaymentSheet.tsx`       | new                                                                         |
| `lib/pdf.ts`                            | "Paid by" block, A4 + thermal                                              |
| `app/(ui)/reports/page.tsx`             | breakdown card, receipt chips, reprint with tenders                        |

---

## Verification

1. `npx prisma migrate dev` → `npx prisma generate` → `npm run dev`.
2. **Cash sale**: add items → Checkout → sheet opens with Cash prefilled for the full total → Confirm. `select * from sale_payments` shows one CASH row equal to `sales.total`.
3. **Split**: Cash 2,000 + M-Pesa with a reference for the balance. Confirm stays disabled until Remaining hits zero; two rows land and sum to the total.
4. **Bank + add**: ring one sale on Equity; ring another via "+ Add bank" with a new name. Check `bank_name` on the rows, and that the new name appears in Settings → bank list afterwards.
5. **Offline**: DevTools → Offline → ring a sale → back online → `drain()` posts it. Payments arrive intact; trigger a second drain and confirm no duplicate rows (upsert by id).
6. **Floor clamp**: ring a sale where the client total differs from the server's clamped total; confirm the sale still saves, `sum(sale_payments.amount) = sales.total`, and the audit event carries `paymentAdjustment`.
7. **Receipt**: print and download from the receipt modal, then reprint the same sale from Reports — the "Paid by" block matches. Reprint a pre-feature sale and confirm it still renders cleanly. Test both A4 and 80mm (Settings → receipt format).
8. **Reports**: `/api/reports/payments?from=…&to=…` totals equal the day's non-voided sales; void a sale (`app/api/sales/[id]/route.ts`) and confirm its amount leaves the breakdown and `voidedExcludedCount` rises.
9. `npm run lint` and `npm run build`.