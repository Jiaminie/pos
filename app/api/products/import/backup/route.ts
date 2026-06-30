import { createCatalogBackup } from '@/lib/import/backup'
import { importLog } from '@/lib/import/logger'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function POST() {
  const user = await requireUserWithPermission(undefined, 'catalog.product.manage')
  if (!isAuthUser(user)) return user

  try {
    importLog('Backup requested', 'backup')
    const started = Date.now()
    const backup = await createCatalogBackup()
    importLog(`Backup API completed in ${((Date.now() - started) / 1000).toFixed(1)}s`, 'backup')
    return Response.json({
      data: {
        backupId: backup.backupId,
        manifest: backup.manifest,
      },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Backup failed'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
