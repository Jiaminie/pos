/**
 * Phase 3 verification — StockCountUpload Prisma model, migration, and client type parity.
 * Run: npm run verify:phase3
 *
 * Live `prisma migrate deploy` requires DATABASE_URL — not run here.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { StockCountUploadStatus } from '@prisma/client'
import {
  RESUMABLE_DRAFT_STATUSES,
  TERMINAL_UPLOAD_STATUSES,
} from '../lib/stock-count/types'

const root = join(__dirname, '..')

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

function verifyPrismaValidate() {
  console.log('\n3a. Prisma schema validates and client generates')
  const validate = spawnSync('npx', ['prisma', 'validate'], { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  assert('prisma validate', validate.status === 0, (validate.stderr || validate.stdout || '').trim())

  const clientTypes = join(root, 'node_modules/.prisma/client/index.d.ts')
  assert('Prisma client generated', existsSync(clientTypes))
  const clientSrc = readFileSync(clientTypes, 'utf8')
  assert('client exposes stockCountUpload delegate', clientSrc.includes('get stockCountUpload()'))
  assert('client exposes StockCountUploadStatus enum', clientSrc.includes('StockCountUploadStatus'))
}

function verifySchemaModel() {
  console.log('\n3b. schema.prisma — model, enum, reverse relations')
  const schema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')

  assert('StockCountUploadStatus enum present', schema.includes('enum StockCountUploadStatus'))
  assert('model StockCountUpload present', schema.includes('model StockCountUpload'))
  assert('branchId is non-nullable', /branchId\s+String\s+@map\("branch_id"\)/.test(schema))
  assert('extractedRows is Json?', schema.includes('extractedRows Json?'))
  assert('submittedAt optional', schema.includes('submittedAt   DateTime?'))
  assert('Branch.stockCountUploads reverse relation', schema.includes('stockCountUploads StockCountUpload[]'))
  assert('User.stockCountUploads reverse relation', (schema.match(/stockCountUploads StockCountUpload\[\]/g) ?? []).length >= 2)
  assert('@@index([branchId, status])', schema.includes('@@index([branchId, status])'))
  assert('@@index([uploadedById, status])', schema.includes('@@index([uploadedById, status])'))
  assert('@@map("stock_count_uploads")', schema.includes('@@map("stock_count_uploads")'))
}

function verifyMigration() {
  console.log('\n3c. Migration SQL')
  const migrationDir = join(root, 'prisma/migrations/20260702120000_add_stock_count_uploads')
  const sqlPath = join(migrationDir, 'migration.sql')
  assert('migration directory exists', existsSync(migrationDir))
  const sql = readFileSync(sqlPath, 'utf8')
  assert('creates StockCountUploadStatus enum', sql.includes('CREATE TYPE "StockCountUploadStatus"'))
  assert('creates stock_count_uploads table', sql.includes('CREATE TABLE "stock_count_uploads"'))
  assert('extracted_rows JSONB column', sql.includes('"extracted_rows"  JSONB'))
  assert('branch_id FK to branches', sql.includes('REFERENCES "branches"("id")'))
  assert('uploaded_by_id FK to users', sql.includes('REFERENCES "users"("id")'))
  assert('branch_id + status index', sql.includes('stock_count_uploads_branch_id_status_idx'))
  assert('uploaded_by_id + status index', sql.includes('stock_count_uploads_uploaded_by_id_status_idx'))
}

function verifyTypeParity() {
  console.log('\n3d. Client types match Prisma enum')

  const prismaValues = Object.values(StockCountUploadStatus).sort()
  const clientValues = [
    ...RESUMABLE_DRAFT_STATUSES,
    ...TERMINAL_UPLOAD_STATUSES,
  ].sort()

  assert(
    'lib/stock-count/types.ts covers all Prisma enum values',
    JSON.stringify(prismaValues) === JSON.stringify(clientValues),
    `prisma=${JSON.stringify(prismaValues)} client=${JSON.stringify(clientValues)}`,
  )
  assert(
    'resumable + terminal partition the enum',
    RESUMABLE_DRAFT_STATUSES.length + TERMINAL_UPLOAD_STATUSES.length === prismaValues.length,
  )
}

function verifyStaticWiring() {
  console.log('\n3e. Phase 3 wiring in later routes')
  const extractRoute = readFileSync(join(root, 'app/api/stock-count/extract/route.ts'), 'utf8')
  assert('extract GET uses shared RESUMABLE_DRAFT_STATUSES', extractRoute.includes('RESUMABLE_DRAFT_STATUSES'))
  assert('extract creates PENDING row before Claude', extractRoute.includes("status: 'PENDING'") && extractRoute.includes('prisma.stockCountUpload.create'))
}

function main() {
  console.log('Stock Count — Phase 3 verification\n')
  verifyPrismaValidate()
  verifySchemaModel()
  verifyMigration()
  verifyTypeParity()
  verifyStaticWiring()
  console.log(`\n${passed} passed, ${failed} failed`)
  if (!process.env.DATABASE_URL) {
    console.log('\nNote: DATABASE_URL not set — live `prisma migrate deploy` not run (migration SQL verified statically).')
  }
  process.exit(failed > 0 ? 1 : 0)
}

main()
