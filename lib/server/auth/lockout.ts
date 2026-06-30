const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000

type Entry = { fails: number; lockedUntil: number }

const attempts = new Map<string, Entry>()

// Key on branch + caller (IP/device), NOT the attempted PIN — otherwise an
// attacker iterating PINs gets a fresh counter each time and never trips the
// lockout. Counting per caller stops sequential brute force.
function key(branchId: string, caller: string): string {
  return `${branchId}:${caller}`
}

export function isLockedOut(branchId: string, caller: string): boolean {
  const entry = attempts.get(key(branchId, caller))
  if (!entry) return false
  if (entry.lockedUntil > Date.now()) return true
  if (entry.lockedUntil > 0 && entry.lockedUntil <= Date.now()) {
    attempts.delete(key(branchId, caller))
  }
  return false
}

export function recordFailedAttempt(branchId: string, caller: string): number {
  const k = key(branchId, caller)
  const entry = attempts.get(k) ?? { fails: 0, lockedUntil: 0 }
  entry.fails += 1
  if (entry.fails >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS
    entry.fails = 0
  }
  attempts.set(k, entry)
  return MAX_ATTEMPTS - entry.fails
}

export function clearAttempts(branchId: string, caller: string): void {
  attempts.delete(key(branchId, caller))
}
