import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { prisma } from '@/lib/server/db'
import { importLog } from './logger'

const LOCAL_BACKUP_ROOT = path.join(process.cwd(), 'prisma', 'backups')
const isServerless = Boolean(process.env.VERCEL)

export type CatalogBackupManifest = {
  createdAt: string
  productCount: number
  transactionCount: number
  incidentCount: number
  storage: 'filesystem' | 'ephemeral'
}

export type CatalogBackupResult = {
  backupId: string
  backupPath: string
  manifest: CatalogBackupManifest
}

function serialize<T>(data: T): string {
  return JSON.stringify(data, (_key, value) => {
    if (value !== null && typeof value === 'object' && typeof value.toString === 'function' && 'd' in value) {
      return value.toString()
    }
    return value
  }, 2)
}

function resolveBackupRoot(): string {
  if (isServerless) return path.join(os.tmpdir(), 'pos-backups')
  return LOCAL_BACKUP_ROOT
}

export async function createCatalogBackup(): Promise<CatalogBackupResult> {
  importLog('Reading products from database…', 'backup')
  const products = await prisma.product.findMany({ orderBy: { createdAt: 'asc' } })
  importLog(`Read ${products.length} products`, 'backup')

  importLog('Reading transactions and incidents…', 'backup')
  const [transactions, incidents] = await Promise.all([
    prisma.inventoryTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.incident.findMany({ orderBy: { createdAt: 'asc' } }),
  ])
  importLog(`Read ${transactions.length} transactions, ${incidents.length} incidents`, 'backup')

  const now = new Date()
  const backupId = `catalog-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`

  const manifest: CatalogBackupManifest = {
    createdAt: now.toISOString(),
    productCount: products.length,
    transactionCount: transactions.length,
    incidentCount: incidents.length,
    storage: isServerless ? 'ephemeral' : 'filesystem',
  }

  // Vercel has a read-only filesystem; /tmp is ephemeral and not shared across requests.
  // Record counts so imports can proceed safely without blocking on disk writes.
  if (isServerless) {
    importLog('Serverless deploy — backup manifest only (no disk write)', 'backup')
    return { backupId, backupPath: '', manifest }
  }

  const backupRoot = resolveBackupRoot()
  const backupPath = path.join(backupRoot, backupId)

  try {
    fs.mkdirSync(backupPath, { recursive: true })
    importLog(`Writing backup to ${backupId}…`, 'backup')
    fs.writeFileSync(path.join(backupPath, 'products.json'), serialize(products))
    fs.writeFileSync(path.join(backupPath, 'inventory_transactions.json'), serialize(transactions))
    fs.writeFileSync(path.join(backupPath, 'incidents.json'), serialize(incidents))
    fs.writeFileSync(path.join(backupPath, 'manifest.json'), serialize(manifest))
    importLog('Backup write complete', 'backup')
    return { backupId, backupPath, manifest }
  } catch (err) {
    importLog(
      `Filesystem backup failed (${err instanceof Error ? err.message : 'unknown'}) — manifest only`,
      'backup',
    )
    return { backupId, backupPath: '', manifest: { ...manifest, storage: 'ephemeral' } }
  }
}
