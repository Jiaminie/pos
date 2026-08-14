import type { Branch } from './types'

const BRANCH_KEY = 'pos_branch_id'
const ORG_KEY    = 'pos_org_id'
const BRANCH_IDENTITY_KEY = 'pos_branch_identity_v1'

/**
 * Receipt identity for the branch this device belongs to.
 *
 * Receipts are rendered synchronously from localStorage (see loadSettings), and
 * must keep printing correctly offline, so the device's own branch row is
 * mirrored here whenever branches sync. Blank fields mean "fall back to the
 * org-wide StoreSettings".
 */
export type BranchIdentity = {
  id: string
  name: string
  code: string
  address: string
  paymentDetails: string
  bankOptions: string
}

export function getMyBranchIdentity(): BranchIdentity | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(BRANCH_IDENTITY_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as BranchIdentity
    // A stale identity from a previous device assignment would print another
    // branch's till, so only trust it while it matches the current branch.
    return parsed.id === getMyBranchId() ? parsed : null
  } catch {
    return null
  }
}

/** Mirror the device's branch row locally. Pass the full synced branch list. */
export function cacheMyBranchIdentity(branches: Branch[]): void {
  if (typeof window === 'undefined') return
  const id = getMyBranchId()
  if (!id) return
  const mine = branches.find((b) => b.id === id)
  if (!mine) return
  const identity: BranchIdentity = {
    id: mine.id,
    name: mine.name?.trim() ?? '',
    code: mine.code ?? '',
    address: mine.address?.trim() ?? '',
    paymentDetails: mine.paymentDetails ?? '',
    bankOptions: mine.bankOptions ?? '',
  }
  localStorage.setItem(BRANCH_IDENTITY_KEY, JSON.stringify(identity))
}

export function clearMyBranchIdentity(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(BRANCH_IDENTITY_KEY)
}

export function getMyBranchId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(BRANCH_KEY)
}

export function setMyBranchId(id: string): void {
  if (typeof window === 'undefined') return
  // Reassigning the device invalidates the cached identity immediately — never
  // print the old branch's till while waiting for the next sync.
  if (id !== localStorage.getItem(BRANCH_KEY)) clearMyBranchIdentity()
  localStorage.setItem(BRANCH_KEY, id)
}

export function clearMyBranchId(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(BRANCH_KEY)
}

export function getMyOrgId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ORG_KEY)
}

export function setMyOrgId(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ORG_KEY, id)
}
