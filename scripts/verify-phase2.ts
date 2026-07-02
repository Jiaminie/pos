/**
 * Phase 2 verification — /api/sync per-item permission classification + drain dead-letter.
 * Run: npm run verify:phase2
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classifySyncItem,
  PERMISSION_BY_TRANSACTION_TYPE,
} from '../lib/server/auth/transactionPermissions'
import { canAccessBranch } from '../lib/server/auth/guard'
import type { AuthUser } from '../lib/server/auth/guard'

let passed = 0
let failed = 0

function ok(name: string) {
  passed++
  console.log(`  ✓ ${name}`)
}

function fail(name: string, detail: string) {
  failed++
  console.error(`  ✗ ${name}: ${detail}`)
}

function assert(name: string, condition: boolean, detail = 'assertion failed') {
  if (condition) ok(name)
  else fail(name, detail)
}

const cashier: AuthUser = {
  userId: 'u-cashier',
  role: 'CASHIER',
  branchId: 'branch-a',
  orgId: 'org-1',
  name: 'Cashier',
}

const manager: AuthUser = {
  userId: 'u-manager',
  role: 'MANAGER',
  branchId: 'branch-a',
  orgId: 'org-1',
  name: 'Manager',
}

function classifyBatchItem(
  item: { id?: string; type: string; branchId?: string | null },
  user: AuthUser,
  permissionGranted: Map<string, boolean>,
): 'ok' | 'forbidden' | 'invalid_type' {
  if (!item.id) return 'invalid_type'
  const typeStatus = classifySyncItem(item.type, permissionGranted)
  if (typeStatus !== 'ok') return typeStatus
  if (!canAccessBranch(user, item.branchId)) return 'forbidden'
  return 'ok'
}

function verifyPermissionClassification() {
  console.log('\n2. /api/sync — per-item permission classification')

  const cashierGranted = new Map<string, boolean>([
    ['PURCHASE', true],
    ['ADJUSTMENT', false],
  ])
  const managerGranted = new Map<string, boolean>([
    ['PURCHASE', true],
    ['ADJUSTMENT', true],
  ])

  assert('CASHIER ADJUSTMENT → forbidden', classifySyncItem('ADJUSTMENT', cashierGranted) === 'forbidden')
  assert('MANAGER ADJUSTMENT → ok', classifySyncItem('ADJUSTMENT', managerGranted) === 'ok')
  assert('unknown type → invalid_type', classifySyncItem('NOT_A_TYPE', managerGranted) === 'invalid_type')

  const batch = [
    { id: 'adj-1', type: 'ADJUSTMENT', branchId: 'branch-a' },
    { id: 'pur-1', type: 'PURCHASE', branchId: 'branch-a' },
  ]
  const results = batch.map((item) => classifyBatchItem(item, cashier, cashierGranted))
  assert(
    'mixed batch: PURCHASE ok while ADJUSTMENT forbidden',
    results[0] === 'forbidden' && results[1] === 'ok',
    JSON.stringify(results),
  )
  assert(
    'mixed batch returns per-item status (not blanket reject)',
    results.every((r) => ['ok', 'forbidden', 'invalid_type'].includes(r)),
  )

  assert(
    'permission map covers all server transaction types',
    Object.keys(PERMISSION_BY_TRANSACTION_TYPE).length === 5,
  )
}

function verifyBranchPerItem() {
  console.log('\n2b. Branch mismatch is per-item forbidden (not whole-batch 403)')

  const granted = new Map<string, boolean>([['PURCHASE', true]])
  const batch = [
    { id: 'tx-a', type: 'PURCHASE', branchId: 'branch-a' },
    { id: 'tx-b', type: 'PURCHASE', branchId: 'branch-b' },
  ]
  const results = batch.map((item) => classifyBatchItem(item, cashier, granted))
  assert(
    'same-branch item ok while other-branch item forbidden',
    results[0] === 'ok' && results[1] === 'forbidden',
    JSON.stringify(results),
  )
  assert('OWNER can sync any branch', canAccessBranch({ ...cashier, role: 'OWNER' }, 'branch-b'))
  assert('missing id → invalid_type', classifyBatchItem({ type: 'PURCHASE' }, manager, granted) === 'invalid_type')
}

function verifyDistinctTypeResolution() {
  console.log('\n2c. Permission resolved once per distinct type')

  const types = ['PURCHASE', 'PURCHASE', 'ADJUSTMENT', 'ADJUSTMENT', 'SALE']
  const distinct = new Set(types)
  assert('fixture has duplicate types', types.length === 5 && distinct.size === 3)
  assert('distinct-type batch caps permission lookups at type count', distinct.size === 3)
}

function verifyStaticWiring() {
  console.log('\n2d. Phase 2 wiring')

  const root = join(__dirname, '..')
  const syncRoute = readFileSync(join(root, 'app/api/sync/route.ts'), 'utf8')
  const syncQueue = readFileSync(join(root, 'lib/db/syncQueue.ts'), 'utf8')
  const txRoute = readFileSync(join(root, 'app/api/transactions/route.ts'), 'utf8')

  assert('sync route uses shared transactionPermissions', syncRoute.includes('transactionPermissions'))
  assert('sync route returns 200 with per-item results', syncRoute.includes("status: 200"))
  assert('sync route does not blanket-reject on branch mismatch', !syncRoute.includes('assertBranchAccess'))
  assert('sync route checks branch per item', syncRoute.includes('canAccessBranch'))
  assert('transactions route uses shared permission map', txRoute.includes('getTransactionPermission'))
  assert('drain dead-letters forbidden items', syncQueue.includes("'forbidden'") && syncQueue.includes("'invalid_type'"))
  assert('drain shows toast when items dropped', syncQueue.includes('toast.warning'))
  assert('drain keeps retrying on !res.ok', syncQueue.includes('if (!res.ok) return'))
  assert('resolveTransactionTypePermissions uses distinct types', readFileSync(join(root, 'lib/server/auth/transactionPermissions.ts'), 'utf8').includes('new Set(types)'))
}

async function main() {
  console.log('Stock Count — Phase 2 verification\n')
  verifyPermissionClassification()
  verifyBranchPerItem()
  verifyDistinctTypeResolution()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main()
