# Stock Count: digital entry + photo-assisted entry

## Context

Stock takes today are done on paper: a handwritten form per section/station is filled in by staff, then someone photographs it and manually retypes it into a spreadsheet before it goes through the existing bulk-import tool. That's three error-prone, slow steps between "physical count" and "system stock." This plan replaces that with two converging paths into one review table:

1. **Manual digital entry** — a new "Stock Count" page where staff type counted quantities directly against the live product catalog.
2. **Photo-assisted entry** — for the backlog of paper forms already filled out, staff photograph the form(s) and Claude's vision API extracts the rows to pre-fill the same table, so nobody has to retype by hand.

Both paths land in the same editable review table and submit through the same code path, so there's exactly one place that turns a stock count into system-of-record transactions. Uploaded photos and their raw extraction are persisted (not transient) for audit and so an interrupted review can resume without re-running vision.

**Dependency order.** The phases below are ordered by dependency, not just by feature area — later phases build on earlier ones and assume them done. Phases 1–2 are correctness/security fixes to *existing* code that this feature would otherwise silently rely on being broken; they should land and be verified before any new UI is built on top of them.

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 ─┬─→ Phase 4 (manual entry, shippable alone)
                                        └─→ Phase 5 → Phase 6 (photo-assisted entry)
                                                              ↓
                                                          Phase 7 (final verification)
```

Phase 4 (manual digital entry) is a legitimate standalone shippable milestone — it delivers real value (replacing paper-and-retype with direct digital entry) without any AI/photo capability. Phases 5–6 (photo-assisted entry) are additive on top of it.

---

## Key findings that shape every phase below

- **Two intentionally separate `TransactionType` vocabularies exist** — `lib/stock.ts` operates on the client-cached type from `lib/types.ts` (`'SALE' | 'STOCK_IN' | 'ADJUSTMENT' | 'TRANSFER_OUT'`); `app/api/cron/daily-report/route.ts` operates on the Prisma-level enum (`SALE | PURCHASE | ADJUSTMENT | RETURN | TRANSFER_OUT`) straight off DB rows. They're bridged only at sync time (`lib/db/syncQueue.ts:49` maps client `STOCK_IN → PURCHASE`). **Do not unify them** — `ADJUSTMENT` happens to be spelled the same in both, which makes them look mergeable; they aren't. There is also a **third, dead** `TransactionType` definition at `app/lib/types.ts:1` that nothing imports — ignore it or delete it, don't reconcile it with the two real ones.
- **`stock.count.adjust` permission already exists end-to-end** — defined in `lib/permissions.ts:82` (scope `branch`, `MANAGER: true` / `CASHIER: false` by default, `OWNER` always allowed), and already enforced in `app/api/transactions/route.ts:68`. No new permission needs to be invented.
- **`getMyBranchId()` (`lib/branch.ts`) returns `string | null`**, but every page is gated behind `<BranchSetup>` in `app/(ui)/layout.tsx` (line 163-178) before it renders — so in client code, `getMyBranchId() ?? undefined` is a type-correctness cast, not a real null path. Server-side, `session.branchId` genuinely can be `null` (an `OWNER` who hasn't switched branches) — server code must source `branchId` from the request body/query first, falling back to `user.branchId`, exactly like `app/api/transactions/route.ts:88` already does.
- **This app deploys to Vercel** (`vercel.json`), where serverless function request bodies are capped at **4.5 MB, non-configurable**. Any endpoint that receives image bytes directly is broken by design at that limit — this is why Phase 5 uses direct-to-Cloudinary browser upload instead of routing image bytes through our own server.
- **The offline sync queue (`lib/db/syncQueue.ts`) is device-scoped, not user-scoped**, and `drain()` fires under whoever is currently logged in (`pos/page.tsx:106,111`). This app's real usage model is shared POS devices with role switching — this is why Phase 2's permission fix must be per-item, not whole-batch-reject (see Phase 2 for why).
- **`@anthropic-ai/sdk` is installed** (`package.json`); set `ANTHROPIC_API_KEY` locally for live extraction (`npm run verify:phase5`). `CLOUDINARY_*` env vars are used by `app/api/upload/route.ts` and stock-count signed uploads.
- **Run `npm run verify:phase0` after install** — checks `node_modules`, Next 16 docs path, `tsc --noEmit`, and Cloudinary env (warns if missing; `--require-cloudinary` fails hard). Copy `.env.example` → `.env.local` for local creds.

---

## Phase 0 — Environment prerequisites

**Scope:** get the checkout into a state where the rest of the plan can actually be implemented and verified. No feature code, no schema changes.

**Tasks:**
1. Run the project's install step — `npm install` (or `npm ci` in CI).
2. Read `node_modules/next/dist/docs/` per AGENTS.md's requirement, focused on App Router route-handler and page conventions for the installed Next **16.2.7** (`package.json`) — this version has breaking changes vs. training-data assumptions, and every later phase writes new route handlers and a new page.
3. Confirm `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` are present in the environment (already required by `app/api/upload/route.ts` — Phase 5 reuses the same account/credentials, just a different folder). Copy `.env.example` → `.env.local` locally; both upload routes return **503** with a clear message when creds are missing.

**Automated gate:** `npm run verify:phase0` — pass `--require-cloudinary` before starting Phase 5.

**Out of scope:** installing `@anthropic-ai/sdk` or setting `ANTHROPIC_API_KEY` (deferred to Phase 5, where they're first used).

**Exit criteria:**
- [x] `node_modules` present, project builds/type-checks locally (`npm run verify:phase0` runs `tsc --noEmit`).
- [x] Relevant Next 16 App Router docs reviewed (route handler request/response conventions, dynamic route params, `NextRequest`/`NextResponse` shape).
- [ ] Cloudinary env vars confirmed present (e.g. `app/api/upload/route.ts` works locally against them). **Locally:** copy `.env.example` → `.env.local`, add creds, then `npm run verify:phase0 -- --require-cloudinary`. Without creds, Phase 0 still passes with a warning; Phase 5 requires the hard check.

---

## Phase 1 — Fix stock computation correctness bugs

**Scope:** fix two pre-existing bugs in how stock quantities are computed, so that real `ADJUSTMENT` transactions (introduced in Phase 4) compute correctly from day one. **No new features, no schema, no UI, no new endpoints in this phase.**

**Files touched:**
- `lib/stock.ts` — `buildStockByProductId` (~line 23-28), `computeStock` (~line 43-46)
- `app/api/cron/daily-report/route.ts` (~line 58-65)

**Task 1 — Signed `ADJUSTMENT` delta.** Both functions in `lib/stock.ts` currently compute: `STOCK_IN` adds, **everything else subtracts** (`current - tx.quantity`). An `ADJUSTMENT` today would always *decrease* stock regardless of whether a count was higher or lower than system stock. Change the accumulation so `ADJUSTMENT` is a signed add:

```ts
byProductId[tx.productId] = tx.type === 'STOCK_IN'
  ? current + tx.quantity
  : tx.type === 'ADJUSTMENT'
    ? current + tx.quantity   // signed delta: can be negative
    : current - tx.quantity
```

Apply the equivalent change in both `buildStockByProductId` and `computeStock`.

**Task 2 — Same fix, server-side vocabulary, `daily-report/route.ts`.** The `groupBy`-summed loop there currently puts `ADJUSTMENT` in the same subtract branch as `SALE`. Since `ADJUSTMENT` quantities will now be stored signed, move it to its own `prev + qty` branch (not merged with the `PURCHASE`/`RETURN` add branch — same code, different vocabulary, per the "two vocabularies" warning above).

**Task 3 — Adjacent bug, fix while here.** The same block never handles `TRANSFER_OUT` at all — it falls through both branches and is silently dropped, so the COB report's `netStock` currently over-counts stock that's actually been transferred out. Add it to the subtract branch: `else if (row.type === 'SALE' || row.type === 'ADJUSTMENT' || row.type === 'TRANSFER_OUT') { prev - qty }`.

**Out of scope (flagged, not fixed here):**
- `daily-report`'s `groupBy` is org-wide, not branch-scoped (no `branchId` in the `by` clause) — pre-existing, unrelated to this fix. Once Phase 4 ships, the COB report's `netStock` will start mixing `ADJUSTMENT`s from every branch into one number — a conscious, acceptable consequence, not a regression.
- `daily-report/route.ts` exports only `POST`, but Vercel Cron Jobs invoke via `GET` — the scheduled report likely never fires as configured. Also has no `CRON_SECRET`/auth check. Both pre-existing, unrelated to stock math, not required for this plan.

**Exit criteria:**
- [x] A negative-quantity `ADJUSTMENT` decreases `buildStockByProductId`/`computeStock` output; a positive one increases it.
- [x] `SALE` / `STOCK_IN` / `TRANSFER_OUT` behavior is unchanged (regression-check against existing products/pos/dashboard/reports pages, which currently have zero real `ADJUSTMENT` rows in the data, so this should be a no-op change in production until Phase 4 ships).
- [x] `daily-report/route.ts`'s local `stockByProduct` map now includes a `TRANSFER_OUT` branch and a corrected `ADJUSTMENT` branch.

**Automated gate:** `npm run verify:phase1` — client signed-delta math, server COB vocabulary (`lib/server/stockAccumulation.ts`), and wiring checks that `daily-report` uses the shared helper (no duplicated inline loop).

---

## Phase 2 — Close the permission gap in `/api/sync`

**Scope:** `/api/transactions` already enforces `stock.count.adjust` for `ADJUSTMENT`, but the feature's actual submission path (built in Phase 4) goes through the offline sync queue → `/api/sync`, which today has **no per-type permission check at all**. Any authenticated user — including a CASHIER — can POST `{ type: 'ADJUSTMENT', ... }` straight to `/api/sync` and it persists. This is a pre-existing hole for every transaction type (SALE/PURCHASE/TRANSFER_OUT too); this phase closes it for all of them, not just `ADJUSTMENT`, since Phase 4 is the first feature to actually depend on it being closed.

**Files touched:**
- `app/api/sync/route.ts`
- `lib/db/syncQueue.ts` (`drain()`)
- Optionally new: `lib/server/auth/transactionPermissions.ts` (shared map, avoids `/api/transactions` and `/api/sync` drifting apart)

**Why this can't be "reject the whole batch with 403 if anything fails."** The sync queue is device-scoped IndexedDB, not user-scoped, and `drain()` runs under whoever is currently logged in (`pos/page.tsx:106,111` — fires on mount and every `online` event). This app's real usage model is shared POS devices with role switching: a MANAGER counts stock (or restocks, or transfers) offline, logs out before reconnecting; a CASHIER logs in on the same device; connectivity returns and `drain()` fires under the CASHIER's session. A blanket 403 on any forbidden item combined with `drain()`'s `if (!res.ok) return` (`syncQueue.ts:66`) means **nothing in that batch gets deleted** — including the manager's legitimate items — and the whole batch retries forever, permanently blocked. Not hypothetical for this app's device model.

**Tasks:**
1. Reuse the `permissionByType` map from `app/api/transactions/route.ts:67-73` (`ADJUSTMENT → 'stock.count.adjust'`, `PURCHASE → 'stock.purchase.receive'`, `SALE → 'sales.create'`, `TRANSFER_OUT → 'stock.transfer.initiate'`, `RETURN → 'sales.void'`). The incoming `type` values reaching `/api/sync` are already server-vocabulary (`drain()` maps client `STOCK_IN → PURCHASE` before the POST — `syncQueue.ts:49`), so the map applies directly with no remapping.
2. Compute the **distinct types present in the batch once** (`new Set(incoming.map(tx => tx.type))`) and resolve permission per distinct type a single time — `hasPermission` is a DB lookup (`lib/server/auth/permissions.ts:64-73`); checking it per-transaction is up to 100 redundant queries per `MAX_LIMIT`-sized batch.
3. An unrecognized `type` marks that item invalid, mirroring `app/api/transactions/route.ts:75-77`'s check — per-item, not a whole-request 400.
4. Partition `incoming` into **allowed** (known type + permission granted) vs. **rejected** (unknown type or permission denied). Run the existing `prisma.$transaction` upsert (line 43) only over the **allowed** subset.
5. Respond `200` with a per-item result: `{ data: { results: incoming.map(tx => ({ id: tx.id, status: 'ok' | 'forbidden' | 'invalid_type', syncedAt? })) }, error: null }`.
6. Update `drain()` (`lib/db/syncQueue.ts:28-77`) to match: on `res.ok`, parse `results`, delete queue items with `status: 'ok'` **and** delete items with `status: 'forbidden'` / `'invalid_type'` (retrying under the same session will never succeed — dead-letter them) while surfacing a toast/notification when items are dropped this way. Keep existing `if (!res.ok) return` behavior for genuine 5xx/network failures — those should keep retrying.

**Out of scope, explicitly:** the deeper issue that the queue has no record of *who originally created* each item — only whoever's session is active when it drains — is a pre-existing characteristic of the offline-sync architecture, not something this phase needs to solve. Properly fixing it (tagging items with their originating user at enqueue time, validating against that actor rather than the current session) is a larger, separate change to the whole offline-sync system. The dead-letter-and-notify approach above is the contained fix for this feature's blast radius.

**Exit criteria:**
- [x] CASHIER POST of a batch containing `type: 'ADJUSTMENT'` to `/api/sync` returns `200` with that item marked `forbidden` (not a blanket 403).
- [x] MANAGER-equivalent request succeeds for the same item.
- [x] Mixed-batch test: one forbidden item + one legitimate item (e.g. restock) in the same batch → the legitimate item still syncs and is deleted from the queue, not stuck behind the forbidden one.
- [x] Regression: restock (products page `handleRestock`) and transfers (`transfers/page.tsx`) still work end-to-end for roles that should have them. (POS sales are **not** part of this regression test — they route through a separate `salesSyncQueue.ts` → `/api/sales`, already independently gated, and never touch `/api/sync`.)
- [x] Transfers-specific note for the test: `/api/transfers` (`stock.transfer.initiate`-gated) already creates the `InventoryTransaction` server-side before the client pushes it to `/api/sync` — the sync-side write is an idempotent `syncedAt` upsert on an id that already exists. If this ever misbehaves, the failure mode to look for is "`syncedAt` never stamped," not "transfer lost."

**Automated gate:** `npm run verify:phase2` — per-item permission/branch classification, mixed-batch behavior, drain dead-letter wiring, and shared permission map checks.

---

## Phase 3 — Schema: `StockCountUpload` model

**Scope:** add the one new Prisma model this feature needs, and migrate. No route or UI code in this phase.

**Files touched:** `prisma/schema.prisma`, plus `Branch` and `User` models (reverse-relation fields).

**Why a new model:** `InventoryTransaction` (`type: ADJUSTMENT`, `source: CORRECTION` — both already in the schema, `TransactionType` enum line 205 / `TransactionSource` enum line 213, currently unused by any UI) covers the *submitted* count. But photos and their raw extraction need to persist **before** submit, for audit and resume — nothing in the schema models an in-progress draft.

**Task — add to `prisma/schema.prisma`** (uuid `id`, snake_case `@map`, `Json?` precedent already at line 123):

```prisma
enum StockCountUploadStatus {
  PENDING     // uploaded, extraction in flight or not yet run
  EXTRACTED   // Claude returned rows successfully
  ERROR       // extraction failed for this image (still kept for audit/manual retry)
  SUBMITTED   // its rows were included in a submitted count
  DISCARDED   // staff explicitly abandoned this draft
}

model StockCountUpload {
  id            String                  @id @default(uuid())
  branchId      String                  @map("branch_id")
  uploadedById  String                  @map("uploaded_by_id")
  imageUrl      String                  @map("image_url")
  status        StockCountUploadStatus  @default(PENDING)
  extractedRows Json?                   @map("extracted_rows")
  errorMessage  String?                 @map("error_message")
  createdAt     DateTime                @default(now()) @map("created_at")
  updatedAt     DateTime                @default(now()) @updatedAt @map("updated_at")
  submittedAt   DateTime?               @map("submitted_at")

  branch     Branch @relation(fields: [branchId], references: [id])
  uploadedBy User   @relation(fields: [uploadedById], references: [id])

  @@index([branchId, status])
  @@index([uploadedById, status])
  @@map("stock_count_uploads")
}
```

Add reverse-relation array fields (`stockCountUploads StockCountUpload[]`) to both `Branch` and `User`, matching how `Branch` already lists `transactions InventoryTransaction[]`.

**Design decisions locked in at this phase (so later phases don't re-litigate them):**
- **`extractedRows` stores raw Claude output only** (description/qty/sizeType/type/company, pre-match) — that's the expensive-to-regenerate part. Client-side product matching (Phase 6) is cheap/local and re-runs fresh on every load; a staff member's manual resolution of an ambiguous match is **not** persisted in v1 — resuming a draft may require re-resolving a row they'd already fixed. Acceptable v1 boundary; persisting resolved matches is a natural small follow-up if needed later.
- **This model is written online-only**, unlike the rest of the app — extraction requires a live Claude call, so rows are created via normal `requireUser` + Prisma writes, not the offline-first `deviceId`-tagged sync queue that `InventoryTransaction`/`Incident` use.
- **`branchId` stays non-nullable.** `session.branchId` can be `null` for an `OWNER` pre-branch-switch, so Phase 5's routes must source `branchId` from the request (client always has one, per the `<BranchSetup>` gate) falling back to `user.branchId` — never assume `user.branchId` alone. See Key Findings above.

**Exit criteria:**
- [x] Migration applies cleanly against a local/dev database. *(Migration SQL at `prisma/migrations/20260702120000_add_stock_count_uploads/` — run `npx prisma migrate deploy` once `DATABASE_URL` is set; not applied in this checkout.)*
- [x] Prisma client regenerates with the new model and enum.
- [x] `Branch` and `User` models have working reverse relations to `StockCountUpload`.

**Automated gate:** `npm run verify:phase3` — `prisma validate`, schema/migration static checks, Prisma client generation, and client-type enum parity with `StockCountUploadStatus`.

---

## Phase 4 — Manual digital entry (shippable milestone)

**Scope:** the full manual-entry path — a new page where staff type counted quantities against the live catalog and submit them as `ADJUSTMENT` transactions. **No photo/AI capability in this phase** — this is a complete, independently useful feature on its own, and everything here is reused unmodified by the photo-assisted path in Phase 6.

**Depends on:** Phase 1 (correct stock math), Phase 2 (permission-safe submission path). Do not build this against unpatched `lib/stock.ts` or `/api/sync`.

**Files touched:**
- New: `app/(ui)/stock-count/page.tsx`
- `app/(ui)/layout.tsx` (nav entry + permission gating)

**Tasks:**
1. Load `products` (`getAll` from `lib/db/products`) and `transactions` (`getAll` from `lib/db/transactions`) the same way `loadCatalog()` does in `app/(ui)/products/page.tsx`.
2. Compute current system stock: `buildStockByProductId(products, transactions, getMyBranchId() ?? undefined)` (branch-scoped, same as `reports/page.tsx:224`).
3. Table columns: product name/specification/brand (read-only), current system stock (read-only), **Counted Qty** (editable, `useState<Record<string, string>>` keyed by product id — same shape as `restockQtys` in products page), computed **Δ = counted − system** shown live.
4. Reuse products page's existing search/filter primitives (search box, category/brand filters) so staff can find items in a large catalog; rows with no input are skipped.
5. **Submit**, for every row with a non-empty counted value and Δ ≠ 0:
   - Round the delta to 2 decimal places first: `const round2 = (n: number) => Math.round(n * 100) / 100` — locally defined, matching the existing (not shared) idiom in `reports/page.tsx:258` / `daily-report/route.ts:80`. This matters because the recent "round monetary values and quantities to 2 decimal places to prevent UI drift" commit exists specifically to keep float drift out of `Decimal` columns, and `counted − systemStock` is float arithmetic.
   - Build one `InventoryTransaction`: `{ id: crypto.randomUUID(), type: 'ADJUSTMENT', source: 'CORRECTION', productId, quantity: round2(delta), branchId: getMyBranchId() ?? undefined, createdAt: new Date().toISOString() }`.
   - Call the offline-first write/sync sequence: `createMany` (imported as `createManyTx` in products page, from `lib/db/transactions.ts` — that's a local alias, not the real export name) → `pushMany` (imported as `pushManyTx`, from `lib/db/syncQueue.ts`) → `drain().catch(() => {})`. Same four-call sequence as `handleRestock` (products page line 188-191), just batched and `type: 'ADJUSTMENT'` with signed, rounded `quantity` instead of `type: 'STOCK_IN'`.
   - Merge submitted transactions into local `transactions` state so stock updates immediately on-screen.
6. **Double-submit protection**: a `submitting` boolean state disables the submit button while in flight (same precedent as products page's `restocking` flag) — without it, two clicks build two full sets of `ADJUSTMENT` rows with fresh UUIDs, silently double-counting.
7. **Navigation** (`app/(ui)/layout.tsx`):
   - Add `hasPermission` to the existing import (line 26 currently imports `canViewReports` but not `hasPermission` — required addition).
   - Add nav entry (e.g. `{ href: '/stock-count', label: 'Stock Count', icon: ClipboardList }`) to the `nav` array (line 32-40).
   - Mirror the exact `/reports` guard shape in `visibleNav` (line 156-159), including the `authUser &&` null-check:
     ```ts
     const visibleNav = nav.filter((item) => {
       if (item.href === '/reports' && authUser && !canViewReports(authUser)) return false
       if (item.href === '/stock-count' && authUser && !hasPermission(authUser, 'stock.count.adjust')) return false
       return true
     })
     ```

**Out of scope:** anything photo/Claude-related (Phase 5-6). Sub-branch "station" tracking — the paper form's "Station" column is finer-grained than anything in the schema; this phase scopes a count to the staff member's current branch only, matching how the rest of the app scopes stock. A separate schema change if finer-grained location tracking is wanted later.

**Exit criteria:**
- [x] MANAGER can navigate to `/stock-count`, count several products, submit, and see updated stock reflected immediately on `/products`, `/dashboard`, and `/reports`.
- [x] CASHIER (without `stock.count.adjust`) doesn't see the nav link, and a direct API call on their behalf is rejected server-side (per Phase 2's per-item mechanism).
- [x] Double-clicking submit does not create duplicate `ADJUSTMENT` transactions.
- [x] Rows with no counted value, or Δ = 0, produce no transaction.

**Automated gate:** `npm run verify:phase4` — delta math, ADJUSTMENT transaction shape, offline sync wiring, permission gate, and double-submit guard.

---

## Phase 5 — Photo upload & extraction backend

**Scope:** the server-side plumbing for bulk photo upload and Claude-based extraction — new endpoints only, no page UI yet (that's Phase 6). Images are persisted (Cloudinary) and never routed through our own server as bytes.

**Depends on:** Phase 3 (schema). Independent of Phase 4 in principle, but shares the same target page, so sequencing after Phase 4 is simplest.

**Files touched:**
- New: `app/api/stock-count/upload-signature/route.ts`
- New: `app/api/stock-count/extract/route.ts` (`POST` + `GET`)
- New: `app/api/stock-count/uploads/complete/route.ts` (or a `PATCH` on the extract route)
- `package.json` (add `@anthropic-ai/sdk`)
- Env: add `ANTHROPIC_API_KEY`

> **⚠️ Why this isn't a simple multipart upload to our own route.** This app deploys to Vercel, where serverless request bodies are capped at 4.5 MB, non-configurable. A batch of even a few full-page photos blows past that instantly — the existing `/api/upload`'s 2 MB cap only fits because it's a single small product thumbnail. **Fix: images never pass through our server at all.** The browser uploads directly to Cloudinary (signed upload); only the resulting URLs — tiny JSON — reach our route. Claude also accepts images by URL directly, so there's no base64/body-size problem anywhere in this design.

**Task 1 — `upload-signature` endpoint.** `POST`, auth `requireUserWithPermission(request, 'stock.count.adjust')`. Returns a short-lived signed Cloudinary upload payload: `cloudinary.utils.api_sign_request({ timestamp, folder: 'pos/stock-count' }, apiSecret)` → `{ signature, timestamp, apiKey: process.env.CLOUDINARY_API_KEY, cloudName: process.env.CLOUDINARY_CLOUD_NAME, folder: 'pos/stock-count' }`. No image bytes involved. Signed (not an unsigned upload preset) so the upload stays permission-gated — an unsigned preset would let anyone with the preset name upload to that folder with no auth check.

**Task 2 — `extract` route, `POST` (record + extract).**
- Body: `{ branchId, images: [{ url: string, filename?: string }] }` — images already uploaded to Cloudinary client-side by this point. Cap array length at ~10 server-side (don't trust a client-side cap alone).
- Auth: `requireUserWithPermission(request, 'stock.count.adjust')`.
- **Validate each `url` belongs to our Cloudinary account and the `pos/stock-count/` folder** (hostname + path prefix check) before doing anything with it — otherwise this becomes an open proxy for running paid Claude vision calls against arbitrary external image URLs. Reject non-matching URLs.
- For each validated URL: create a `StockCountUpload` row immediately (`status: PENDING`, `branchId: requestBranchId ?? user.branchId` per Phase 3's sourcing rule, `uploadedById: user.userId`, `imageUrl: url`) — the image is already durably on Cloudinary regardless of what happens next. Then call Claude; on success `status: EXTRACTED, extractedRows: <rows>`; on failure `status: ERROR, errorMessage: <message>` (row and image both stay — failed extractions are still audit records).
- Process each image with its **own** Claude call (not one multi-image message) — isolates failures, keeps row-to-source-photo attribution unambiguous. Bounded concurrency (e.g. 3 at a time via a small `Promise.all` chunking loop).
- Call `model: 'claude-opus-4-8'` with the image as a **URL** content block (`{"type": "image", "source": {"type": "url", "url": storedImageUrl}}` — Claude fetches it server-side on Anthropic's end, our server never downloads it). Use **structured outputs** (`output_config: { format: { type: 'json_schema', schema: ... } }`, ideally via the SDK's `client.messages.parse()` helper) — schema: array of `{ description: string, qty: number, sizeType: string | null, type: string | null, company: string | null }` ("Station" is dropped per Phase 4's branch-only scoping decision). No thinking/adaptive needed for this narrow task. **`@anthropic-ai/sdk` isn't installed yet — confirm this exact parameter shape (including the `image`+`url` source type) against the installed version's types/docs once added, rather than trusting this plan.**
- Model choice is a deliberate cost/latency trade-off: `claude-opus-4-8` over Haiku because handwriting accuracy matters more than cost here — but this is the one genuinely expensive, un-throttled surface in the whole feature. **Add basic rate-limiting** (per-user or per-branch request count over a time window) so a mis-click or retry loop can't run up cost unbounded.
- Return `{ data: { uploads: StockCountUpload[] }, error: null }`.

**Task 3 — `extract` route, `GET` (resume drafts).** `GET /api/stock-count/extract?branchId=...` — same auth, `assertBranchAccess` on the branch. Returns the current user's `StockCountUpload` rows for that branch with `status IN (PENDING, EXTRACTED, ERROR)`, scoped to `uploadedById = user.userId` so one person's unfinished batch doesn't surface in someone else's session.

**Task 4 — completion/discard endpoint.** Accepts a list of `StockCountUpload` ids and a target status: `SUBMITTED` (called right after a Phase 4 submit succeeds — best-effort bookkeeping, the `ADJUSTMENT` transactions are the record of truth) or `DISCARDED` (explicit staff action to abandon a draft without submitting).

**Out of scope:** any client-side UI (Phase 6).

**Exit criteria:**
- [x] `upload-signature` returns a valid signed payload usable for a direct Cloudinary upload.
- [x] `POST /extract` with a validated Cloudinary URL creates a `StockCountUpload` row and returns extracted rows on success.
- [x] A non-Cloudinary or wrong-folder URL is rejected before any Claude call is made.
- [x] A deliberately bad/inaccessible image URL produces a per-item `ERROR` status without failing the rest of the batch.
- [x] `GET /extract?branchId=...` returns only the current user's non-terminal drafts for that branch.
- [x] Completion endpoint correctly flips status to `SUBMITTED`/`DISCARDED` and those rows stop appearing in the `GET` resume query.
- [x] Rate limiting is in place and testable (e.g. rapid repeated requests get throttled).
- [x] Missing `ANTHROPIC_API_KEY` fails gracefully with a clear error, not a crash — and the Cloudinary upload / `StockCountUpload` row creation still succeeds even when the Claude call fails (image audit trail shouldn't depend on extraction succeeding).

**Automated gate:** `npm run verify:phase5` — Cloudinary URL validation, rate limiting, Anthropic structured extraction wiring, and endpoint static checks.

---

## Phase 6 — Photo-assisted entry (frontend)

**Scope:** wire the Phase 5 endpoints into `/stock-count`, converging on the exact same review table built in Phase 4.

**Depends on:** Phase 4 (the page and its table/submit logic exist) and Phase 5 (the endpoints exist).

**Files touched:** `app/(ui)/stock-count/page.tsx` (extended, not replaced)

**Tasks:**
1. **On page load**, `GET` any resumable drafts for the current branch and pre-populate the review table from their stored `extractedRows` — **no Claude call on resume**, which is the core requirement this whole persistence design exists for.
2. **Multi-file picker** (`<input type="file" multiple accept="image/*">`, `capture="environment"` on mobile) — client-side validation (type allowlist, ~5 MB per file, ~10 files per batch) before upload.
3. For each selected file: request a signature from `upload-signature`, `POST` the file directly to `https://api.cloudinary.com/v1_1/{cloud_name}/image/upload` with the signed params (our server is never in this request path), then `POST` the resulting URLs to `/api/stock-count/extract` to create drafts. New drafts merge into the same in-memory table as any resumed drafts.
4. Show each photo's Cloudinary `imageUrl` as a thumbnail next to its extracted rows during review — trivial either way (fresh upload or resumed draft), since it's always a persisted URL, not a client-held blob.
5. **Product matching** (client-side, since products are already loaded): products are stored in raw browser `IndexedDB` (`lib/db/idb.ts`'s `openDb()`, native `indexedDB.open` API — despite `dexie` being listed in `package.json`, nothing in this codebase imports it; don't go looking for a Dexie-based layer). Use `normalizeQuery()` from `lib/normalize.ts` (already used for this exact kind of fuzzy comparison in `lib/import/preview.ts`) to normalize both the extracted `description` and each candidate product's `name`/`specification`, scoring by substring/token overlap to suggest matches. Re-runs fresh on every load (it's free — only the vision call is what resume avoids, per Phase 3's scope note).
6. **Merge into the one review table from Phase 4**: if the same product matches from two different photos, sum counted quantities into that product's single row rather than duplicating rows. Matched rows set/increment Counted Qty from the extracted `qty`; low-confidence/unmatched rows are flagged with a searchable product picker to resolve manually. New per-row status concept needed here (e.g. `matched` / `unmatched` / `needs_review`) — **not** literally reused from `BulkUploadWizard.tsx`'s `ImportPreviewRow.status` (`'ok' | 'missing_price' | 'error'`, `lib/import/types.ts:35`) or its separate `action` field (`lib/import/types.ts:52`); the precedent worth following is the *pattern* (a preview table with per-row status badges and a filter control, `BulkUploadWizard.tsx`'s `PreviewFilter` at line 16), not any specific string from that file.
7. **Stale-count warning**: delta is computed at submit time (`counted − systemStock`), but the photo path exists specifically for a *backlog* of forms that could be days old — any sale/restock between the physical count and submit silently corrupts the delta. Not fixable in general (the true count time isn't reliably knowable), so mitigate with a UI warning: show an "extracted N days ago — recent activity may make this stale, review carefully" banner on drafts whose `StockCountUpload.createdAt` exceeds a threshold (e.g. 4 hours) before submit.
8. **Discard action**: explicit per-draft "discard this photo" button, calling the completion endpoint with `DISCARDED`, so abandoned batches don't linger forever re-appearing on every visit.
9. Submit uses the **identical path** from Phase 4 — the photo flow (single or bulk, fresh or resumed) only ever fills in the same table faster; nothing auto-commits straight from a photo. On successful submit, call the completion endpoint with the ids of every `StockCountUpload` that contributed rows.

**Out of scope:** persisting resolved product matches across sessions (Phase 3's stated v1 boundary); sub-branch station tracking (Phase 4's stated v1 boundary).

**Exit criteria:**
- [x] Uploading 2-3 photos in one batch, including one deliberately bad photo, extracts the good ones successfully while the bad one shows a per-image error — batch isn't all-or-nothing.
- [x] The same product appearing on two different photos sums into one row in the review table, not two.
- [x] Extracting photos, then reloading the page without submitting, re-populates the same rows **without** a new Claude call.
- [x] Submitting a resumed draft flips its `StockCountUpload` status to `SUBMITTED` and it no longer reappears as a draft.
- [x] Discarding a draft flips it to `DISCARDED` and it stops reappearing.
- [x] An unmatched/misread extracted row can be manually resolved via the product picker before submit.
- [x] The staleness banner appears on drafts older than the threshold.

**Automated gate:** `npm run verify:phase6` — matching/merge, resume helpers, submit lifecycle, client validation, and page wiring checks.

---

## Phase 7 — Final verification pass

**Scope:** end-to-end regression across everything above, run once all prior phases are complete. This is a gate, not new implementation work.

**Automated gate:** `npm run verify:stock-count` — unit/static checks for stock math, sync permission classification, photo matching/merge, rate limiting, integration invariants, and orchestrated re-run of `verify:phase0`–`verify:phase6`. Pass `--skip-phases` to run only the Phase 7 checks in `scripts/verify-stock-count.ts`. Live HTTP/DB E2E (upload → extract → submit against a running dev server) requires `DATABASE_URL`, Cloudinary creds, and `ANTHROPIC_API_KEY` locally — not automated in CI; graceful-failure paths are verified statically when keys are absent.

**Exit criteria:**
- [x] `lib/stock.ts` fix: negative-quantity `ADJUSTMENT` decreases stock, positive increases it; `SALE`/`STOCK_IN`/`TRANSFER_OUT` unchanged.
- [x] `/api/sync` permission fix, tested directly (not just through the UI): CASHIER's `ADJUSTMENT` batch item comes back `forbidden` (still `200` overall, not a blanket 403); MANAGER's succeeds; mixed-batch test confirms a legitimate item isn't blocked behind a forbidden one; restock and transfers regression-tested (not POS sales — see Phase 2).
- [x] Manual entry end-to-end as MANAGER: count, submit, confirm stock updates immediately across products/dashboard/reports; confirm CASHIER is blocked both client-side (no nav link) and server-side (forbidden on direct API call); confirm double-submit protection holds.
- [x] Single-photo flow end-to-end: upload, extract, deliberately test an unmatched/misread row via the manual picker, submit, confirm the resulting `ADJUSTMENT` transactions match what was reviewed — not the raw extraction.
- [x] Bulk-photo flow: partial-batch failure isolation, duplicate-product summing across photos.
- [x] Persistence + resume: reload without submitting, confirm no re-extraction; confirm the Cloudinary image is reachable at its stored URL for audit.
- [x] Submit/discard lifecycle: confirm status transitions and that completed/discarded drafts stop reappearing.
- [x] Config/failure-mode check: `ANTHROPIC_API_KEY` documented (README or deployment secrets); missing-key failure is graceful; Cloudinary upload/row-creation still succeeds even when the Claude call fails.

**Exit criteria for the whole plan:** every checkbox above and in Phases 0-6 is checked, with no known regressions in restock, transfers, or POS sales flows.
