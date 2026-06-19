# Plan: POS Lookup Modes (Catalog vs Barcode)

## Objective

Support two distinct ways cashiers find products at the register — **catalog search** (hardware / building supplies) and **barcode lookup** (retail) — without changing behavior for existing hardware deployments. A store-wide setting controls which mode is active; the default remains catalog search.

## Background

The current POS search is optimized for hardware-style inventory:

- Text search across **name, SKU, specification, brand, and category**
- Category and brand filters for browsing large catalogs
- SKUs are often **generated from name + specification**, not scanned from packaging

```ts
// lib/brands.ts — current search fields
normalizeQuery(product.name)
normalizeQuery(product.sku)
normalizeQuery(product.specification ?? '')
normalizeQuery(getProductBrand(product))
normalizeQuery(categoryName ?? '')
```

Retail vendors (future customers) typically identify products by **manufacturer barcode** (EAN/UPC), separate from internal SKU. USB barcode scanners behave as keyboard wedges (type digits + Enter) and expect **exact match → add to cart** behavior.

The first deployed customer deals in hardware items where barcode scanning does not apply. The feature must be **off by default** and configurable per store in Settings so other vendors can enable it without code forks.

## Design

### Lookup modes

| Mode       | Target customer              | POS behavior |
|------------|------------------------------|--------------|
| `catalog`  | Hardware, building supplies  | Current UX — browse, filter, text search on spec/SKU *(default)* |
| `barcode`  | Retail, convenience          | Scanner-first; exact barcode match adds one unit to cart |
| `hybrid`   | Supermarkets, mixed stock    | Scanner + full catalog search and filters |

### Settings

Add to `StoreSettings` (synced via existing `/api/settings` flow):

```ts
posLookupMode: 'catalog' | 'barcode' | 'hybrid'  // default: 'catalog'
```

Expose in a new **POS** tab on the Settings page (alongside Store, Pricing, Documents) with plain-language descriptions of each mode. Hardware customers never need to change this.

Optional: seed the default from an env var on first `StoreSettings` create (e.g. `POS_LOOKUP_MODE=catalog`) — the database setting remains the source of truth after that.

### Data model

Barcode is **separate from SKU**:

| Field     | Hardware                         | Retail                              |
|-----------|----------------------------------|-------------------------------------|
| `sku`     | Generated from name + spec       | Internal identifier                 |
| `barcode` | Unused (null)                    | Manufacturer EAN/UPC, unique if set |

```prisma
// Product — add when onboarding first retail vendor
barcode  String?  @unique
```

- Nullable and unique — hardware products leave it empty
- Hidden in product form, import, and search when `posLookupMode === 'catalog'`

### POS behavior (barcode / hybrid only)

1. Include `barcode` in the local search index (normalized, same as SKU).
2. On search input, if query **exactly matches** one product's barcode → add one unit to cart and clear the search field.
3. If no exact barcode match → fall back to existing text search (`matchesProductSearch`).
4. In `barcode` mode, consider hiding category/brand filters to maximize checkout speed; keep them in `hybrid`.
5. Update search placeholder by mode:
   - `catalog`: "Search by name, SKU, brand, category or size…"
   - `barcode` / `hybrid`: "Scan barcode or search…"
6. Optional: auto-focus the search input on POS load when mode is `barcode` or `hybrid`.

USB scanners require no special API — they type into the focused input and send Enter. Exact-match logic should run on the same debounced/deferred search path used today.

### Offline

Barcode lookup must work offline. Products are already cached in IndexedDB via Dexie; the barcode field syncs with the rest of the product record. No server round-trip is needed at checkout.

### Centralized search

Avoid duplicating filter logic between POS, Products page, and API. Extend `matchesProductSearch` in `lib/brands.ts` (or a dedicated `lib/product-search.ts`) to accept optional `barcode` and respect `posLookupMode` from settings. POS exact-match → add-to-cart stays in the POS page; shared text matching stays in the lib.

## Implementation Phases

### Phase 1 — Settings scaffold (no behavior change)

**Goal:** Future-proof configuration; zero impact on hardware customer.

1. Add `posLookupMode` to Prisma `StoreSettings` (default `'catalog'`).
2. Migration + update `lib/settings.ts`, `app/api/settings/route.ts`, and Settings UI (new POS tab).
3. Load `posLookupMode` on the POS page (for placeholder / conditional UI later).
4. Document default in seed / env if desired.

**Files (expected):**

- `prisma/schema.prisma`
- `prisma/migrations/…`
- `lib/settings.ts`
- `app/api/settings/route.ts`
- `app/(ui)/settings/page.tsx`

### Phase 2 — Barcode data (first retail vendor)

1. Add nullable `barcode` to `Product` in Prisma + migration.
2. Update product API routes (`POST`, `PATCH`, import batch).
3. Sync barcode through Dexie / seed pipeline.
4. Show barcode field on product form and CSV import **only when** `posLookupMode !== 'catalog'`.

**Files (expected):**

- `prisma/schema.prisma`
- `lib/types.ts`
- `app/(ui)/products/page.tsx`
- `app/api/products/route.ts`, `app/api/products/[id]/route.ts`
- Import routes under `app/api/products/import/`

### Phase 3 — POS scanner UX

1. Add barcode to POS search index.
2. Implement exact-match → add to cart (clear search on success).
3. Mode-specific placeholder, optional filter hiding, optional auto-focus.
4. Extend `matchesProductSearch` and API product search `OR` clause for barcode when mode ≠ `catalog`.

**Files (expected):**

- `app/(ui)/pos/page.tsx`
- `lib/brands.ts` or new `lib/product-search.ts`
- `app/api/products/route.ts`

## Out of scope (for now)

- Camera-based barcode scanning (mobile camera) — keyboard-wedge USB scanners only
- Multiple barcodes per product (case packs, alternate UPCs)
- Barcode label printing
- Per-user mode overrides (store-wide setting is sufficient)

## Verification

### Phase 1

- [ ] Fresh install defaults to `catalog` mode.
- [ ] Settings POS tab saves and syncs `posLookupMode` across devices.
- [ ] POS search behavior unchanged for hardware (catalog default).

### Phase 2

- [ ] Barcode field hidden when mode is `catalog`.
- [ ] Barcode field visible and persistable when mode is `barcode` or `hybrid`.
- [ ] Duplicate barcodes rejected (unique constraint).
- [ ] Barcode syncs offline via existing product seed/sync.

### Phase 3

- [ ] **Catalog mode:** no barcode in search; no auto-add behavior.
- [ ] **Barcode mode:** scan exact UPC → product added to cart, search cleared.
- [ ] **Barcode mode:** unknown barcode shows clear feedback (toast or empty state).
- [ ] **Hybrid mode:** scan works; text search and filters still work.
- [ ] Works offline after initial sync.
- [ ] Partial barcode / name search still finds products in `hybrid` mode.

## References

- Current POS search: `app/(ui)/pos/page.tsx`
- Shared search helper: `lib/brands.ts` (`matchesProductSearch`)
- Settings: `lib/settings.ts`, `app/(ui)/settings/page.tsx`, `prisma/schema.prisma` (`StoreSettings`)
- Product model: `prisma/schema.prisma` (`Product`)
