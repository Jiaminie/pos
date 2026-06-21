const BRANCH_KEY = 'pos_branch_id'
const ORG_KEY    = 'pos_org_id'

export function getMyBranchId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(BRANCH_KEY)
}

export function setMyBranchId(id: string): void {
  if (typeof window === 'undefined') return
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
