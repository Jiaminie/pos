# Configurable RBAC — Permission Catalog & Enforcement

_Last updated: 2026-06-30 · Companion to [rbac-plan.md](./rbac-plan.md)_

## Concept

Roles are **not** a hardcoded permission map. Each operation is a **capability
toggle** the owner flips per role in Settings:

- **OWNER / admin** — always has everything; **not editable** (super-admin).
- **MANAGER & CASHIER** — start from seeded defaults; owner switches each
  capability on/off org-wide. A cashier can be granted stock ops during the
  transition ("before the system harmonizes") and tightened later — no code
  change, just a toggle.

Two capabilities are **owner-only and never togglable**:
- `catalog.price.cost_and_floor` — margin secrets, and the floor is the discount
  wall; a manager must not be able to move the wall.
- `admin.permissions.configure` — otherwise a manager could grant themselves
  everything.

Other admin functions (store settings, branch CRUD, branch switch, managing
managers) are also owner-only.

## Permission catalog & defaults

| Permission key | Group | Scope | MGR default | CASH default | Togglable |
| --- | --- | --- | :--: | :--: | :--: |
| `catalog.product.manage` (edit / image / bulk / delete) | Catalog | org | off | off | ✓ |
| `catalog.price.selling` | Catalog | org | off | off | ✓ |
| `catalog.price.cost_and_floor` | Catalog | org | — | — | owner-only |
| `catalog.taxonomy.manage` (brands / categories / units) | Catalog | org | off | off | ✓ |
| `stock.count.adjust` | Stock | branch | on | off | ✓ |
| `stock.purchase.receive` | Stock | branch | on | off | ✓ |
| `stock.transfer.initiate` | Stock | branch | on | off | ✓ |
| `stock.transfer.receive` | Stock | branch | on | off | ✓ |
| `stock.view` | Stock | branch | on | on | ✓ |
| `sales.create` | Sales | branch | on | on | ✓ |
| `sales.discount` | Sales | branch | on | on | ✓ |
| `sales.void` (refund) | Sales | branch | on | off | ✓ |
| `incident.create` | Sales | branch | on | on | ✓ |
| `reports.view.own` | Reports | self | on | off | ✓ |
| `reports.view.branch` | Reports | branch | on | off | ✓ |
| `reports.view.org` | Reports | org | — | — | owner-only |
| `users.manage.cashiers` | Admin | branch | on | off | ✓ |
| `admin.settings` · `admin.branch.manage` · `admin.branch.switch` · `admin.users.manage_managers` · `admin.permissions.configure` | Admin | org | — | — | owner-only |

**Refunds** (`sales.void`) = *authority to approve a void*. Manager has it by
default (the branch override authority); cashier does not — a cashier can
**initiate** a refund but it requires a manager step-up PIN to complete. Every
void is audit-logged and alerts the owner. See
**[fraud-controls.md](./fraud-controls.md)** for the flow. (Owner can toggle
`sales.void` off for managers to make refunds owner-only again.)
**Cashier reports** default to nothing (`reports.view.own/branch` off).

## Storage

```prisma
model RolePermission {
  id             String   @id @default(uuid())
  organizationId String   @map("organization_id")
  role           Role                          // only MANAGER / CASHIER stored
  permission     String                        // permission key from the catalog
  granted        Boolean  @default(false)
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, role, permission])
  @@map("role_permissions")
}
```

- OWNER is never stored (always allowed).
- Owner-only permissions are never stored — enforced in code, not toggled.
- Seed inserts the MANAGER/CASHIER defaults above for the org.

## Enforcement (replaces the role-based guard in plan Phase 2)

The Phase 2 guard becomes permission-based:

```
requirePermission(req, 'stock.count.adjust')
  1. read session → { userId, role, branchId, orgId }
  2. role === OWNER            → allow
  3. owner-only permission     → deny (only OWNER reaches here)
  4. look up RolePermission(org, role, key).granted → allow / 403
  5. branch-scoped op          → also filter/verify by session.branchId
```

A grant authorizes the **action**; **branch scope still applies on top** — a
manager with `stock.count.adjust` can adjust only their own branch. OWNER bypasses
the table entirely.

Client side: fetch the effective permission set via `GET /api/auth/me` and
hide/disable controls accordingly (UX only — the server is the real gate).

## Implementation map

| Piece | Location |
| --- | --- |
| Permission catalog & defaults | `lib/permissions.ts` |
| DB load / seed / matrix | `lib/server/auth/permissions.ts` |
| `requirePermission` guard | `lib/server/auth/guard.ts` |
| Effective permissions in session | `GET /api/auth/me` |
| Owner matrix API | `GET/PUT /api/permissions` |
| Settings UI | `components/settings/PermissionsSection.tsx` |
| Client helpers | `lib/auth.ts` (`hasPermission`, `canViewReports`, …) |

Run `seedRolePermissions(orgId)` (called from `prisma/seed.ts`) after migrate to
backfill defaults for existing orgs.

## Plan deltas (how this changes [rbac-plan.md](./rbac-plan.md))

- **Phase 1** — add the `RolePermission` model + migration; seed MGR/CASH defaults.
- **Phase 2** — guard is `requirePermission(key)` (above), not `requireRole`;
  `GET /api/auth/me` returns the user's effective permissions.
- **Phase 3** — Settings gains a **Roles & Permissions** screen (OWNER-only): a
  matrix of togglable capabilities × {Manager, Cashier} with switches; owner-only
  rows shown locked/hidden. `GET/PUT /api/permissions` (guarded by
  `admin.permissions.configure`).
- **Phases 4–6** — each gated operation maps to its permission key (e.g. branch
  switch → `admin.branch.switch`; refund → `sales.void`; reports → the
  `reports.view.*` keys).
