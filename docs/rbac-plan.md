# RBAC, Branch Switching & Discount Accountability — Implementation Plan

_Last updated: 2026-06-30_

## Context & decisions (locked)

The system today has **no users, no auth, no roles**. "Which branch" is a
device-level `localStorage` value (`lib/branch.ts`), every API route is open, and
a "sale" is a loose batch of `InventoryTransaction` rows with no grouping and no
actor. This plan introduces the first concept of a *person* and makes sales
accountable.

Decisions made with the owner:

| Question | Decision |
| --- | --- |
| Auth method | **PIN** (4–6 digits) per user; owner authenticates, staff use PINs |
| Branch binding | Cashier/manager **pinned to one branch**; only OWNER roams |
| Enforcement | **Server-enforced from day one** (not just UI gating) |
| Roles | OWNER (admin) → MANAGER (1 per branch) → CASHIER (∞ per branch) |
| Who creates whom | Owner creates managers + cashiers; **manager creates cashiers in own branch** |
| Discount policy | Cashier discounts **freely above the floor**; **below floor is impossible** (hard wall, no override) |
| Logging | **Every** sale (discounted or not) silently stamped with `cashierId`; invisible at counter |
| Discount levels | **Both** per-line item **and** whole-sale (cart) total |

Floor reused from existing system: `floor = lowestPrice ?? costPrice × (minMarkupPercent / 100)`.

> **Permission model:** roles are not a fixed permission map — capabilities are
> owner-configurable toggles. See **[rbac-permissions.md](./rbac-permissions.md)**
> for the permission catalog, defaults, storage, and enforcement.
>
> **Fraud controls:** audit log, refund override flow, offline caps, anomaly
> alerts, and shift/cash reconciliation (Phase 7) live in
> **[fraud-controls.md](./fraud-controls.md)**.
>
> Both docs layer on top of the phases below.

## Tech baseline (verified)

- Next.js **16.2.7** (App Router), React **19.2.4** — _APIs differ from older Next; read `node_modules/next/dist/docs/` before coding._
- Prisma **7.8** with `@prisma/adapter-pg`; client in `lib/server/db.ts`; migrations via `prisma migrate dev`; seed `prisma/seed.ts` (configured in `prisma.config.ts`).
- Offline-first PWA: Dexie/IndexedDB (`lib/db/*`), sync queue (`lib/db/syncQueue.ts`), catalog reseed (`lib/db/seed.ts` → `replaceCatalogFromServer()`).
- App gate: `app/(ui)/layout.tsx` (client) renders `BranchSetup` when no `branchId`. `nav` array there drives the menu. Branch chip (lines ~118–132) is where the switcher goes.

---

## Phase 1 — Schema, migration, seed (foundation)

**Goal:** model people, sales grouping, and discount fields; enforce structural invariants in the DB.

### Schema changes (`prisma/schema.prisma`)

```prisma
enum Role { OWNER MANAGER CASHIER }

model User {
  id             String   @id @default(uuid())
  name           String
  pinHash        String   @map("pin_hash")
  role           Role
  organizationId String   @map("organization_id")
  branchId       String?  @map("branch_id")   // null only for OWNER
  active         Boolean  @default(true)
  createdById    String?  @map("created_by_id")
  createdAt      DateTime @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id])
  branch       Branch?      @relation(fields: [branchId], references: [id])
  createdBy    User?        @relation("UserCreatedBy", fields: [createdById], references: [id])
  created      User[]       @relation("UserCreatedBy")
  sales        Sale[]

  @@index([organizationId])
  @@index([branchId])
  @@map("users")
}

model Sale {
  id                 String   @id              // client-generated uuid (offline)
  organizationId     String   @map("organization_id")
  branchId           String   @map("branch_id")
  deviceId           String   @map("device_id")
  cashierId          String   @map("cashier_id")
  subtotal           Decimal                    // sum of line list prices × qty
  lineDiscountTotal  Decimal  @default(0) @map("line_discount_total")
  saleDiscountAmount Decimal  @default(0) @map("sale_discount_amount") // cart-level
  total              Decimal
  createdAt          DateTime @default(now()) @map("created_at")
  syncedAt           DateTime? @map("synced_at")

  branch  Branch  @relation(fields: [branchId], references: [id])
  cashier User    @relation(fields: [cashierId], references: [id])
  lines   InventoryTransaction[]

  @@index([branchId])
  @@index([cashierId])
  @@index([createdAt])
  @@map("sales")
}
```

Add to `InventoryTransaction` (SALE lines):

```prisma
  saleId             String?  @map("sale_id")
  originalUnitPrice  Decimal? @map("original_unit_price") // list price pre-discount
  lineDiscountAmount Decimal? @map("line_discount_amount")
  sale               Sale?    @relation(fields: [saleId], references: [id])
  // + @@index([saleId])
```

Add back-relations on `Organization` (`users User[]`) and `Branch` (`users User[]`, `sales Sale[]`).

### Manager invariant (raw SQL in the migration)

Prisma can't express conditional-unique. After `prisma migrate dev --create-only`,
edit the generated migration to append:

```sql
CREATE UNIQUE INDEX one_manager_per_branch
  ON users (branch_id) WHERE role = 'MANAGER';
```

(Also guarded in app logic — belt and suspenders.)

### Seed (`prisma/seed.ts`)

- Create/ensure the OWNER user; PIN from `OWNER_PIN` env (fallback dev default, warn).
- Hash with the chosen KDF (see Phase 2).

### Deliverables / acceptance

- `prisma migrate dev` applies cleanly; `prisma generate` succeeds.
- DB rejects a 2nd manager on a branch.
- Seeded owner exists.

**Risk:** existing `InventoryTransaction` SALE rows predate `saleId` (nullable → fine). Reports must tolerate `saleId = null` legacy rows.

---

## Phase 2 — PIN auth & server enforcement

**Goal:** identity on every request; below-this is real security, not UI.

### Pieces

1. **Hashing** — add `bcryptjs` (pure-JS, no native build → safe on Vercel) or `@node-rs/argon2`. PINs are low-entropy, so: slow hash + lockout after N fails. `lib/server/auth/pin.ts` (`hashPin`, `verifyPin`).
2. **Session** — signed JWT in an **httpOnly cookie**. `lib/server/auth/session.ts` (`createSession`, `readSession`, `clearSession`). Payload: `{ userId, role, branchId, orgId }`. Sign with `AUTH_SECRET` env (HS256).
3. **Login route** — `POST /api/auth/login` `{ pin, branchId }` → verify against active users of that branch → set cookie. `POST /api/auth/logout`. `GET /api/auth/me`.
4. **Guard helper** — `lib/server/auth/guard.ts`:
   `requireUser(req, { roles?, branchScoped? })` → reads cookie, 401 if absent, 403 if role/branch mismatch. **Branch-scoped queries are filtered by the session's branch** for non-owners. _Apply inside each route handler — do not rely on middleware semantics until the Next 16 routing-middleware guide is read._
5. **Apply guards** to every mutating route: `products`, `transactions`, `sales` (new), `transfers`, `branches`, `settings`, `incidents`, `units`, `upload`, `sync`. GET routes scoped by branch for non-owners.

### Offline-first handling (important)

POS counters are usually online; design for that with graceful offline:

- **Online PIN login** establishes a session cookie that lasts a shift (e.g. 12h).
- Cache the authenticated `{ userId, name, role, branchId }` locally so the UI knows who is logged in while offline.
- **Offline mutations** already queue (`syncQueue.ts`) — each queued `Sale` carries `cashierId` captured at creation, so attribution survives offline. On reconnect, the sync request carries the session cookie; server validates and writes.
- **Stretch (multi-cashier offline switching):** cache *pinHashes of that branch's active users* locally to verify PIN offline. Tradeoff: a stolen device exposes low-entropy hashes to offline brute force → mitigate with slow hash + only active-branch users + remote wipe of device token. Defer unless needed.

### Deliverables / acceptance

- Hitting any mutating API without a cookie → 401.
- Cashier of branch A cannot read/write branch B data (server-enforced).
- Login with correct PIN sets session; wrong PIN locks after N tries.

---

## Phase 3 — User management in Settings (role-aware)

**Goal:** owner and managers create/manage people, in `app/(ui)/settings/`.

### UI

- New "Team" section in Settings, rendered by role from `GET /api/auth/me`:
  - **OWNER:** list/create/deactivate managers + cashiers across all branches; assign branch; set/reset PIN; (only one manager slot per branch — UI enforces + server 409s).
  - **MANAGER:** list/create/deactivate **cashiers in own branch only**.
  - **CASHIER:** no access (section hidden + route guarded).
- Create flow: name + branch (locked for managers) + role + PIN (or auto-generate, show once).

### Routes

- `GET /api/users` (scoped), `POST /api/users` (guarded: owner→any; manager→cashier in own branch), `PATCH /api/users/:id` (rename, reset PIN, activate/deactivate), with the manager-per-branch guard mirrored server-side.

### Acceptance

- Manager creating a 2nd manager → blocked (409).
- Manager creating a cashier in another branch → 403.
- Deactivated user cannot log in.

---

## Phase 4 — Owner branch switching

**Goal:** owner roams; everyone else is pinned.

### Changes

- Distinguish **binding** (user's `branchId`, immutable for staff) from **active branch** (localStorage, owner-changeable).
- `app/(ui)/layout.tsx`: replace the static branch chip with a **switcher dropdown for OWNER only**; staff see a static chip.
- On switch: `setMyBranchId(newId)` → `replaceCatalogFromServer()` (re-seed IndexedDB for the new branch) → refresh active views. **Requires connectivity** (show a notice if offline; block switch).
- `BranchSetup` becomes part of the **login gate**: first choose/confirm branch (device binding), then PIN login. For staff, branch is implied by their account; for a fresh device, owner sets it up.

### Acceptance

- Owner switches branch → catalog + reports reflect new branch after re-sync.
- Cashier has no switcher; forcing another branchId is rejected server-side (Phase 2 guard).

---

## Phase 5 — POS discounts (line + cart) with floor clamp & silent attribution

**Goal:** the accountability feature, end to end.

### Model already in place (Phase 1). POS flow:

- **Per-line discount:** edit a line's unit price (or % off); clamp at that product's floor. Store `originalUnitPrice`, `lineDiscountAmount`.
- **Whole-sale discount:** amount or % on cart total; **allocated across lines proportionally**, each line clamped at its floor. If the requested amount would breach floors, cap at max allowable and surface _"max discount: KES X."_ Persist on `Sale.saleDiscountAmount`.
- **Checkout** → `POST /api/sales`: creates `Sale` + its `InventoryTransaction` SALE lines in one transaction; **server re-validates every floor** (client clamp is UX only); stamps `cashierId` from session. Offline: build the `Sale` locally (uuid) in a new Dexie `sales` store, queue for sync.
- Cashier sees normal totals — **no indication that attribution/logging is happening.**

### Files

- `components/pos/*` (discount controls), POS page (`app/(ui)/pos/page.tsx`), `lib/db/idb.ts` (+`sales` store), `lib/db/sales.ts` (local CRUD), `lib/db/syncQueue.ts` (push sales), new `app/api/sales/route.ts`.

### Floor allocation rule (whole-sale)

```
maxCartDiscount = Σ over lines ( (unitPrice_afterLine − floor) × qty )
applied = min(requested, maxCartDiscount)
per-line share = applied × (line.subtotal / cart.subtotal), clamped at floor
```

### Acceptance

- Cannot drive any line below floor via line OR cart discount (verified server-side).
- Every completed sale has a `cashierId`; discounts recorded with original vs final.
- Works offline → syncs with attribution intact.

---

## Phase 6 — Reporting

**Goal:** turn the logs into the answers the owner wanted.

### Reports (`app/(ui)/reports/`, new API queries)

- **Discounts by cashier** (count, total KES, avg %), filter by branch + date.
- **Sales by cashier / by branch** (volume, revenue, margin).
- **Below-list-price sales** — every line where `lineDiscountAmount > 0`, with who and how much.
- Owner sees all branches; manager sees own branch; cashier none (or own only — TBD).
- Tolerate legacy `saleId = null` / `cashierId`-less rows (label "unattributed").

### Acceptance

- Owner can answer "who discounted what, how much, where, when."

---

## Cross-cutting / risks

- **Read the Next 16 + Prisma 7 guides first** (per AGENTS.md) — middleware, route handlers, and cookies may differ from older patterns.
- **PIN entropy:** low; rely on lockout + slow hash; avoid caching hashes offline unless the multi-cashier-offline stretch is needed.
- **Migration ordering:** Sale/User are additive and nullable on existing rows — no backfill required, but reports must handle nulls.
- **New deps:** a hashing lib + a JWT/cookie-signing lib (or Web Crypto HMAC to avoid a dep). Confirm before adding.
- **eTIMS / receipts:** unaffected, but receipts can later show the cashier name (see existing receipt work).

## Suggested sequencing

1 → 2 → (3 ∥ 4) → 5 → 6. Phases 3 and 4 can overlap once auth (2) lands. Each
phase is independently shippable behind the prior one.
