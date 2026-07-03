# Plan: Device UI Modes (Desktop / Touch / Mobile)

## Objective

Let each POS device choose a **UI mode** during onboarding (and later in Settings → Device) so the register is optimized for how it is actually used: mouse-and-keyboard desktop, touch-screen terminal, or phone-sized mobile checkout.

## Audit (current state)

### Onboarding

- `BranchSetup` only asks for branch assignment; no device profile.
- Device identity is an auto-generated UUID in `localStorage` (`pos_device_id`).
- The `Device` Prisma model exists but is unused server-side.

### POS UI (`app/(ui)/pos/page.tsx`)

| Area | Current behavior | Touch gap |
|------|------------------|-----------|
| Layout | `flex-col` on small screens, side cart `max-h-[50vh]` | Cart competes with products + bottom nav |
| Product grid | `grid-cols-2`, `h-28` images, `text-sm` | Cards OK for touch but no press feedback |
| Cart qty controls | `p-1`, 12px icons | Below 44×44px tap target guideline |
| Discount chips | `text-[10px] py-1` | Too small for fingers |
| Remove button | `p-1`, 14px icon | Too small |
| Checkout row | `py-2.5` | Acceptable but no `active:` feedback |
| Modals | Centered `max-w-sm` | Hard to reach on phones; Products page uses bottom sheets |
| Bottom nav clearance | No `pb-28` on POS | Checkout can sit under fixed tab bar |
| Safe areas | `safe-area-pb` referenced but undefined | iPhone home indicator not handled |
| Viewport | No `viewport-fit=cover` | Notched devices not accounted for |

### What works elsewhere

- `products/page.tsx` and `stock-count/page.tsx` use `pb-28 md:pb-6`, mobile card views, and bottom-sheet dialogs.
- POS does **not** follow these patterns today.

### Responsive vs touch-optimized

The app is **breakpoint-responsive** (`sm:`, `md:`) but not **input-aware**. There is no distinction between a narrow desktop window and a touch tablet, and no mobile-first POS layout.

## Design

### UI modes (per device, localStorage)

| Mode | Target hardware | POS behavior |
|------|-----------------|--------------|
| `desktop` | PC + mouse/keyboard | Current UX *(default, backward compatible)* |
| `touch` | Touch monitor, tablet landscape | Larger tap targets, `active:` press feedback, taller controls; side-by-side layout when wide enough |
| `mobile` | Phone, small tablet portrait | Full-screen products, floating cart FAB, cart as bottom drawer, bottom-sheet modals, hide app tab bar on `/pos` |

Storage key: `pos_device_ui_mode` via `lib/device-ui.ts` (same pattern as `pos_branch_id`).

### Onboarding

Extend `BranchSetup` with a **required** UI mode selector (dropdown) above branch list. Pre-select saved value if the user re-runs setup.

### Settings

Add UI mode control to **Settings → Device** tab alongside branch assignment. Changes apply immediately (no server sync).

### Global CSS

- Define `.safe-area-pb` and `.safe-area-pt` using `env(safe-area-inset-*)`.
- Add `[data-ui-mode="touch"]` / `[data-ui-mode="mobile"]` utility hooks where useful.

### Layout (`app/(ui)/layout.tsx`)

- Set `data-ui-mode` on the shell when mounted.
- Hide bottom tab bar on `/pos` when mode is `mobile` (POS is full-screen checkout).
- Touch/desktop keep the tab bar.

### POS optimizations by mode

**Shared (touch + mobile):**

- Min 44×44px tap targets on qty, remove, pagination, checkout.
- `active:scale-[0.98]` / `active:bg-*` instead of hover-only feedback.
- Taller search input (`py-3`).
- Bottom-sheet modals on `mobile`; larger centered modals on `touch`.

**Mobile only:**

- Products fill viewport; cart hidden behind FAB.
- Cart drawer slides up (80vh max) with safe-area padding.
- Product grid: 2 columns, taller images (`h-36`).
- `h-dvh` instead of `h-screen`.
- `pb-safe` on scroll regions.

**Touch only:**

- Keep side cart layout at `md+`; at narrow widths use larger stacked cart (60vh max).
- Product grid: 3 columns when wide, larger cards.
- Larger pagination buttons.

**Desktop:**

- No changes (existing classes).

## Implementation

### Files

| File | Change |
|------|--------|
| `lib/device-ui.ts` | **New** — types, storage, mode metadata, class helpers |
| `components/BranchSetup.tsx` | UI mode dropdown in onboarding |
| `app/(ui)/settings/page.tsx` | UI mode in Device tab |
| `app/globals.css` | Safe-area utilities |
| `app/layout.tsx` | `viewport-fit=cover` |
| `app/(ui)/layout.tsx` | `data-ui-mode`, hide nav on mobile POS |
| `app/(ui)/pos/page.tsx` | Mode-aware layout, cart drawer, touch targets, bottom sheets |

### Out of scope

- Server-side `Device` model sync (localStorage is sufficient for UI prefs).
- Camera barcode scanning.
- Swipe-to-delete cart lines.
- Per-user UI mode overrides.

## Verification

- [ ] Fresh install: onboarding shows UI mode dropdown; defaults to Desktop.
- [ ] Mode persists across reloads and is editable in Settings → Device.
- [ ] Desktop: POS unchanged from before.
- [ ] Touch: cart controls ≥ 44px; product cards show press feedback.
- [ ] Mobile: FAB cart on POS; drawer opens/closes; modals slide from bottom; tab bar hidden on `/pos`.
- [ ] Safe-area padding on iOS PWA (home indicator not overlapping checkout).
- [ ] Other pages still show bottom nav in mobile mode.

## References

- POS page: `app/(ui)/pos/page.tsx`
- Mobile patterns: `app/(ui)/products/page.tsx`
- Device storage: `lib/device.ts`, `lib/branch.ts`
- Onboarding: `components/BranchSetup.tsx`
