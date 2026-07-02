/**
 * Phase 0 verification — environment prerequisites for stock-count work.
 * Run: npm run verify:phase0
 *
 * Pass `--require-cloudinary` to fail when Cloudinary creds are absent
 * (needed before Phase 5 photo upload work).
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { config as loadEnv } from 'dotenv'
import {
  cloudinaryEnvReady,
  missingCloudinaryEnvVars,
} from '../lib/server/cloudinary'

const root = join(__dirname, '..')
const requireCloudinary = process.argv.includes('--require-cloudinary')

let passed = 0
let failed = 0
let warned = 0

function ok(name: string) {
  passed++
  console.log(`  ✓ ${name}`)
}

function fail(name: string, detail: string) {
  failed++
  console.error(`  ✗ ${name}: ${detail}`)
}

function warn(name: string, detail: string) {
  warned++
  console.warn(`  ⚠ ${name}: ${detail}`)
}

function main() {
  console.log('Stock Count — Phase 0 verification\n')

  const envLocal = join(root, '.env.local')
  if (existsSync(envLocal)) {
    loadEnv({ path: envLocal })
    ok('.env.local loaded')
  } else {
    warn('.env.local', 'not found — copy .env.example to .env.local and fill in values')
  }

  if (existsSync(join(root, 'node_modules'))) {
    ok('node_modules present')
  } else {
    fail('node_modules', 'missing — run npm install')
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: { next?: string }
  }
  const nextVersion = pkg.dependencies?.next
  if (nextVersion?.startsWith('16.')) {
    ok(`Next.js ${nextVersion} (App Router target)`)
  } else {
    fail('Next.js version', `expected 16.x, got ${nextVersion ?? 'unknown'}`)
  }

  const nextDocs = join(root, 'node_modules/next/dist/docs/01-app')
  if (existsSync(nextDocs)) {
    ok('Next 16 App Router docs available (node_modules/next/dist/docs/)')
  } else {
    fail('Next docs', 'node_modules/next/dist/docs/01-app not found — run npm install')
  }

  console.log('\nType-check')
  const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  if (tsc.status === 0) {
    ok('tsc --noEmit')
  } else {
    fail('tsc --noEmit', (tsc.stderr || tsc.stdout || 'failed').trim().slice(0, 500))
  }

  console.log('\nCloudinary (required by app/api/upload/route.ts and Phase 5 photo upload)')
  const missing = missingCloudinaryEnvVars()
  if (cloudinaryEnvReady()) {
    ok('CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET set')
  } else if (requireCloudinary) {
    fail('Cloudinary env', `missing: ${missing.join(', ')}`)
  } else {
    warn(
      'Cloudinary env',
      `missing: ${missing.join(', ')} — add to .env.local before Phase 5; pass --require-cloudinary to fail here`,
    )
  }

  console.log(`\n${passed} passed, ${failed} failed${warned ? `, ${warned} warned` : ''}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main()
