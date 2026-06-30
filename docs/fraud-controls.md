# Fraud Controls

_Last updated: 2026-06-30 · Companion to [rbac-plan.md](./rbac-plan.md) and [rbac-permissions.md](./rbac-permissions.md)_

Fraud-prevention controls layered on top of the RBAC build. Derived from a fraud
advisory, filtered against **this** system's architecture (offline-first PWA,
device-per-branch, org-wide catalog, hard price floor).

> **On the cited evidence:** the advisory quoted ACFE / CBK / McKinsey figures.
> They're plausible but unverified and look embellished — the *controls* are
> sound; don't repeat the *numbers* as fact in marketing without sourcing them.

## What we adopt vs skip

| Advisory recommendation | Decision |
| --- | --- |
| Zero-void/refund + supervisor override + audit log | **Adopt** — manager override + owner alert + audit log (below) |
| No open/pending transactions | **Already covered** — `Sale` is created atomically at checkout; no held-sale concept |
| Offline caps + reconciliation | **Adopt, softened** — warn + alert, never hard-block (below) |
| Granular roles (4 fixed roles) | **Already exceeded** — configurable toggles; no 4th hardcoded role |
| Separation of duties | **Covered** — refund needs a 2nd actor; floor wall blocks price-override fraud |
| End-of-day Z-read + cash count | **Adopt (in scope)** — new shift & cash reconciliation phase (below) |
| GPS/IP geofencing | **Skip** — web PWA, not GPS hardware; devices are already branch-bound, which gives the location control geofencing reaches for |
| Time-fencing (off-hours sales) | **Adopt as a soft alert flag**, not a hard block (markets keep odd hours) |
| Real-time anomaly alerts | **Adopt** — owner alerts on sensitive events (below) |

Note: the advisory allowed "supervisor price override within 10%." **We are
stricter** — below-floor is impossible (no override path), so the price-override
fraud vector doesn't exist. Keep the hard wall; do not add an override.

## 1. Immutable audit log

The backbone of accountability — append-only, never updated or deleted.

```prisma
model AuditEvent {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  branchId       String?  @map("branch_id")
  actorId        String   @map("actor_id")          // who did it
  approvedById   String?  @map("approved_by_id")     // step-up approver, if any
  action         String                              // e.g. SALE_VOID, DISCOUNT, PRICE_CHANGE, PERMISSION_CHANGE, LOGIN
  targetType     String?  @map("target_type")        // Sale | Product | User | RolePermission
  targetId       String?  @map("target_id")
  metadata       Json?                               // before/after, amounts, reason
  deviceId       String?  @map("device_id")
  wasOffline     Boolean  @default(false) @map("was_offline")
  createdAt      DateTime @default(now()) @map("created_at")

  @@index([organizationId, createdAt])
  @@index([branchId, createdAt])
  @@index([actorId])
  @@map("audit_events")
}
```

- **Logged actions:** sale void/refund, discount applied, price change, stock
  adjustment, transfer, user create/disable, permission change, login,
  offline-sale sync.
- **Append-only:** no update/delete routes; only OWNER can read
  (`reports.view.org` / a dedicated audit view).
- Written server-side inside the same transaction as the action it records.

## 2. Refund / void flow (manager override + owner alert)

Decision: cashier may *initiate*, manager *approves* on-site, owner is *notified*.

1. Cashier opens the original `Sale`, taps Refund → enters reason.
2. UI requires a **manager step-up PIN** (any branch user holding `sales.void`).
   Cashier alone cannot complete it.
3. Server records a `RETURN` transaction + an `AuditEvent`
   (`action=SALE_VOID`, `actorId=cashier`, `approvedById=manager`, amounts, reason).
4. **Instant owner alert** fires (see §4).
5. Owner can disable `sales.void` for managers to fall back to owner-only refunds.

## 3. Offline caps — warn + alert, never block

We are offline-first; a flat hard stop (advisory's "5/day, \$100") would brick a
shop during a genuine outage. So: **track, warn, alert — never refuse a sale.**

- Per-device counters of **unsynced** sales: count + total value.
- Owner sets soft thresholds per branch (`StoreSettings`): e.g. warn at N sales
  or KES X unsynced.
- Past threshold: banner warns the cashier ("X sales pending sync") and an owner
  alert fires once reconnected (or via any reachable channel).
- Sales always proceed. `syncQueue.drain()` keeps draining on reconnect.
- Every sale already carries `cashierId` + `wasOffline`, so offline abuse is
  fully attributable after the fact.

## 4. Owner anomaly alerts

Built on the audit log; delivered via Resend (email) now, SMS later.

Triggers (owner-configurable thresholds):
- Any void / refund.
- Discount over a set % or amount.
- More than N refunds/hour by one cashier.
- Offline unsynced backlog past threshold (§3).
- Sale outside business hours (time-fence flag).
- Permission change / new user created.

## 5. Shift & cash reconciliation — **Phase 7 (in scope)**

End-of-day Z-read + blind cash count. New, since no shift/drawer concept exists.

```prisma
model Shift {
  id            String    @id @default(uuid())
  branchId      String    @map("branch_id")
  deviceId      String    @map("device_id")
  openedById    String    @map("opened_by_id")
  openingFloat  Decimal   @map("opening_float")
  closedById    String?   @map("closed_by_id")
  countedCash   Decimal?  @map("counted_cash")     // blind count entered at close
  expectedCash  Decimal?  @map("expected_cash")     // float + cash sales − refunds
  variance      Decimal?                            // counted − expected
  openedAt      DateTime  @default(now()) @map("opened_at")
  closedAt      DateTime? @map("closed_at")

  @@index([branchId, openedAt])
  @@map("shifts")
}
```

Flow:
- **Open shift:** cashier enters opening float; sales attach to the open shift.
- **Close shift (Z-read):** system computes expected cash; cashier enters a
  **blind count** (without seeing expected) → variance computed.
- Variance over a threshold → audit event + owner alert; second-person sign-off
  (manager) recommended.
- Reports: variance by shift / cashier / branch over time.

## Plan deltas

- **Phase 1** — add `AuditEvent` (and `Shift` for Phase 7) models + migrations.
- **Phase 2** — every guarded mutation writes an `AuditEvent` in-transaction.
- **Phase 5 (POS)** — refund flow with manager step-up (§2); offline counters (§3).
- **Phase 6 (Reports)** — audit log view (owner), variance reports.
- **Phase 7 (new)** — shift open/close, blind cash count, variance + reconciliation.
- **Alerts** — new `lib/server/alerts.ts` + triggers wired to audit events (§4).
