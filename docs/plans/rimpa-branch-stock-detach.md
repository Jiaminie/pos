# Clean-slate stock for new branches (Rimpa + future)

## Context

Rimpa and HQ are two `Branch` rows under one `Organization`. `Product` is org-wide, not branch-owned (`prisma/schema.prisma:178-206`) — there is no separate "Rimpa catalog." Rimpa was allowed to sell against HQ's catalog before it had its own inventory data; now it has done a real physical stock count (reconciled from photographed handwritten sheets via Stock Count → Photo review, `app/(ui)/stock-count/page.tsx`) and needs those counts to become its own, self-owned stock — **without inheriting HQ's borrowed numbers**.

The same behaviour must generalise: **every new branch starts as a clean slate** (0 stock) and builds its own inventory purely from its own stock count + subsequent movements. HQ keeps its existing numbers unchanged.

## Validation of the mechanism (what actually produces Rimpa's borrowed "System Stock")

Verified directly in code — there are **two** baseline leaks, and the dominant one was missed in the first draft:

1. **PRIMARY — opening stock via `product.quantity` → `initialStock` (client-side, branch-blind).** This app is offline-first: each device replicates the org catalog into a local DB (`lib/db/seed.ts`). `parseInitialStock` (`lib/db/seed.ts:18`) sums the digits of the global `product.quantity` string ("1573" → 1573) into a numeric `initialStock`, baked onto every local product row with **no branch scoping** (`lib/db/seed.ts:147`). Client stock is then `initialStock + Σ transactions` (`lib/stock.ts:22-36`). Rimpa has ~no transactions of its own, so its "System Stock" ≈ `initialStock` — i.e. HQ's opening quantities. The server does **not** apply this baseline (`lib/server/stockAccumulation.ts:33-41` starts at 0), confirming `initialStock` is a client-only construct.

2. **SECONDARY — null-branch transaction fallback.** Any `InventoryTransaction` with `branchId: null` (legacy pre-branch data) is counted toward *every* branch: `lib/stock.ts:30,48` (`!tx.branchId || tx.branchId === branchId`) and `app/api/transactions/route.ts:34` (`OR: [{ branchId }, { branchId: null }]`).

The Stock Count submit flow itself is **correct and needs no change**: `buildAdjustmentTransactions` posts `delta = counted − system` as a branch-scoped `ADJUSTMENT` (`lib/stock-count/manual.ts:20,40-58`, `page.tsx:747`). Once `system` correctly starts at 0 for a non-HQ branch, submitting a count yields the exact right baseline automatically.

## Model

Opening stock (`initialStock`) and legacy null-branch transactions belong **only to the origin branch (HQ)**. Every other branch — Rimpa, Traingle, and all future branches — computes stock purely from its own branch-scoped transactions, starting from 0.

**Production findings (audit run 2026-07-06):** the org (`307dbd00-…`) has 3 branches — Traingle (`3RD`, the `isPrimary` one), New Junior Plumbers (`HQ`), and Rimpa (`2ND`). The origin that owns the borrowed catalog is **New Junior Plumbers, identified by branch `code = 'HQ'` — NOT the `isPrimary` flag** (primary is Traingle, a different store). So the seed keys opening-stock ownership off `code === 'HQ'`. Also: there are **0 `branchId: null` transactions** (0 of 3,761), so the re-attribution migration and null-fallback removal are inert on current data — kept only as hardening against future null-branch writes. 3,618 of 3,684 products carry the opening-stock baseline being scoped away from non-HQ branches.

## Changes

### A. Scope opening stock to the origin branch — the key, self-replicating fix
In the client catalog seed (`lib/db/seed.ts`), only assign `initialStock` from `product.quantity` when the device's own branch is the opening-stock owner (the primary branch); otherwise assign `0`. The seed already knows the device branch (`getMyBranchId()`, `lib/db/seed.ts:57`) and downloads the branch list, so it can resolve `myBranch.isPrimary`.

- Owner (HQ/primary) device → `initialStock: parseInitialStock(p.quantity)` (unchanged).
- Any other branch → `initialStock: 0`.
- If the branch can't be resolved (device not yet synced), fall back to current behaviour (keep `initialStock`) to avoid accidentally zeroing a legitimate single-branch store.

Because every downstream computation reads `initialStock` from the local product row (`lib/stock.ts:23`, plus ~10 UI call sites in pos/dashboard/reports/products/stock-count), this **single change** makes non-owner branches start clean everywhere at once — and it applies automatically to every future branch with no per-branch configuration. This is what "replicated for other new branches, clean slate for them" requires.

### B. Force existing devices to re-seed
Existing Rimpa devices already have `initialStock` baked into their local DB from a prior sync. Bump the sync version key `pos_last_sync_v2` → `pos_last_sync_v3` (`lib/db/seed.ts:24`) so the next load performs a full replace-sync (`replaceProducts`) and rewrites `initialStock` to 0 on non-owner devices.

### C. Re-attribute existing legacy null-branch transactions to HQ (server, one-off)
New `scripts/reattribute-legacy-stock.ts`, following the dry-run/`--apply` convention of `scripts/drop-import-stock-txns.ts`:
- Resolve the org, then the `isPrimary` branch (with a `--hq-code=<code>` override).
- Dry run: `count()` of `InventoryTransaction where branchId: null`, print a sample + the resolved HQ branch; do nothing.
- `--apply`: `updateMany({ where: { branchId: null }, data: { branchId: hqBranch.id } })`.
- Math no-op for HQ: HQ already sums both its own and null rows via the current `OR` fallback, so re-pointing null → HQ's id leaves HQ's total unchanged while stopping the leak into other branches.

### D. Remove the null-branch fallback (hardening, prevents future leaks)
So no future null-branch write can ever leak into another branch:
- `lib/stock.ts:30` and `:48` — `!tx.branchId || tx.branchId === branchId` → `tx.branchId === branchId`.
- `app/api/transactions/route.ts:34` — drop the `{ branchId: null }` arm, leaving `{ branchId: scopedBranch }`.

### E. Diagnostic script (read-only, run first)
New `scripts/audit-branch-baseline.ts` (pattern of `scripts/check-legacy-adjustments.ts`, shared `prisma` from `lib/server/db`): list every `Branch` with its `isPrimary` flag; count `InventoryTransaction` rows with `branchId: null` grouped by `type`; report how many products have a non-zero `parseInitialStock(quantity)`. Confirms HQ = primary and quantifies both baselines before any write.

### F. Rimpa adopts its count — no code change
After A–D ship and Rimpa re-syncs, staff reconcile the photo-review rows (existing client flow: `handleResolveRow` / `handleAcceptSuggestion`, `page.tsx`) and Submit. With `system = 0`, the posted `ADJUSTMENT` deltas (`counted − 0`) become Rimpa's true opening stock.

## Verification
1. Run `scripts/audit-branch-baseline.ts` — confirm exactly one `isPrimary` branch and that it is HQ (not Rimpa); record null-branch tx count.
2. Run `scripts/reattribute-legacy-stock.ts` dry run, confirm resolved HQ + sample, then `--apply`; re-run audit → 0 null-branch rows.
3. As an **HQ** device: confirm `/stock-count` and dashboard stock figures are unchanged before/after (initialStock still applies, null rows now explicit).
4. As a **Rimpa** device: after the v3 re-sync, confirm "System Stock" reads 0 for previously-inherited items.
5. Reconcile a couple of Rimpa photo-review rows and Submit; confirm resulting stock equals the counted quantity.
6. Simulate/create a fresh test branch: confirm it shows 0 stock for all products with no extra steps (validates the generalisation).
7. Run existing `npm run verify:stock-count` and `check:legacy-adjustments` to catch regressions.

## Critical rollout sequencing
Rimpa must **not submit its in-progress count until after the deploy + device re-sync (v3)**. `buildAdjustmentTransactions` computes `delta = counted − system`; if the count is submitted while `system` still includes the borrowed baseline, the adjustments bake in that baseline and become wrong once it's removed. After re-sync, `system = 0`, so the same entered counts produce `delta = counted` correctly.

## Open questions / assumptions
- **RESOLVED:** origin/owner branch = New Junior Plumbers (`code = 'HQ'`), confirmed by the user. Traingle and Rimpa reset to 0.
- **Scope is stock *quantities* per branch, not splitting the *catalog* (names/SKUs/prices).** Rimpa and HQ keep selling the same product rows; only their stock ledgers diverge. Splitting the catalog per branch would additionally require removing the global uniqueness on `sku`/`barcode` (`prisma/schema.prisma`) and rescoping every product query — out of scope here. Flag if that's actually wanted.
