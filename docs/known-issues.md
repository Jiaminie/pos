# Known issues

Pre-existing issues noticed while working in a given area, not fixed because
they predate the change in progress and are out of scope for it. Listed here
so they don't get lost — pick them up next time you're touching the file.

## `app/(ui)/stock-count/page.tsx` — React Compiler lint errors

Found while fixing the stock-count review findings (2026-07-02). Both predate
that work — `git diff` on the relevant lines was empty before any of those
fixes touched the file. `npx eslint "app/(ui)/stock-count/page.tsx"` reports:

1. **`react-hooks/set-state-in-effect`** (line 197) — `setMyBranchId(getMyBranchId())`
   is called directly in the mount effect body instead of during render or in
   response to an external subscription. Causes a cascading re-render.

2. **`react-hooks/purity`** (line 255) — the `staleDrafts` `useMemo` calls
   `Date.now()` inside its computation, which is an impure call and can produce
   unstable results across re-renders.

Neither breaks functionality today, but both fail the React Compiler's purity
rules and will need fixing before that compiler can be safely enabled for this
file. Fix: move `setMyBranchId` to initial `useState` or a ref-based read;
replace `Date.now()` in the memo with a value computed at render start (or move
the staleness check out of `useMemo` into a `setInterval`-driven state).
