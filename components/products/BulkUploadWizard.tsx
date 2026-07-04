'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { CatalogSyncOverlay } from '@/components/products/CatalogSyncOverlay'
import { replaceCatalogFromServer } from '@/lib/db/seed'
import type { CatalogSyncProgress } from '@/lib/db/sync-progress'
import { initialSyncProgress } from '@/lib/db/sync-progress'
import { IMPORT_BATCH_SIZE } from '@/lib/import/constants'
import type { ImportCommitResult, ImportPreviewResult, ImportPreviewRow } from '@/lib/import/types'

type Step = 'upload' | 'preview' | 'importing' | 'done'

type PreviewFilter = 'all' | 'ok' | 'missing_price' | 'error' | 'create' | 'update'

const PAGE_SIZE = 25

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function BulkUploadWizard({ open, onOpenChange, onComplete }: Props) {
  const [step, setStep] = useState<Step>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [commitResult, setCommitResult] = useState<ImportCommitResult | null>(null)
  const [importProgress, setImportProgress] = useState('')
  const [importLogs, setImportLogs] = useState<string[]>([])
  const [syncingCatalog, setSyncingCatalog] = useState(false)
  const [syncProgress, setSyncProgress] = useState<CatalogSyncProgress | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [importLogs])

  function appendLog(message: string) {
    const line = `${new Date().toLocaleTimeString()} — ${message}`
    setImportLogs((prev) => [...prev, line])
    setImportProgress(message)
  }

  function reset() {
    setStep('upload')
    setFile(null)
    setPreview(null)
    setFilter('all')
    setPage(1)
    setLoading(false)
    setCommitResult(null)
    setImportProgress('')
    setImportLogs([])
    setSyncingCatalog(false)
    setSyncProgress(null)
  }

  function handleOpenChange(next: boolean) {
    if (!next && step === 'importing') return
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleFileSelect(selected: File | null) {
    if (!selected) return
    setFile(selected)
    setLoading(true)
    try {
      const body = new FormData()
      body.append('file', selected)
      const res = await fetch('/api/products/import/preview', { method: 'POST', body })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Preview failed')
      setPreview(json.data as ImportPreviewResult)
      setStep('preview')
      setPage(1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse file')
      setFile(null)
    } finally {
      setLoading(false)
    }
  }

  const filteredRows = useMemo(() => {
    if (!preview) return []
    return preview.rows.filter((row) => {
      if (filter === 'all') return true
      if (filter === 'ok') return row.status === 'ok'
      if (filter === 'missing_price') return row.status === 'missing_price'
      if (filter === 'error') return row.status === 'error'
      if (filter === 'create') return row.action === 'create'
      if (filter === 'update') return row.action === 'update'
      return true
    })
  }, [preview, filter])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const paginated = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  async function handleCommit() {
    if (!preview) return
    setStep('importing')
    setImportLogs([])
    appendLog('Starting catalog backup…')

    try {
      let backupId: string | undefined
      const backupRes = await fetch('/api/products/import/backup', { method: 'POST' })
      const backupJson = await backupRes.json()
      if (!backupRes.ok) {
        appendLog(`Warning: backup skipped (${backupJson.error ?? 'unavailable on server'}) — continuing import`)
      } else {
        const data = backupJson.data as {
          backupId: string
          manifest: { productCount: number; transactionCount: number; storage?: string }
        }
        backupId = data.backupId
        const storageNote = data.manifest.storage === 'ephemeral' ? ' (manifest only)' : ''
        appendLog(
          `Backup recorded${storageNote} (${data.backupId}): ${data.manifest.productCount} products, ${data.manifest.transactionCount} transactions`,
        )
      }

      const rows = preview.rows.filter((r) => r.status !== 'error')
      const batches: typeof rows[] = []
      for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
        batches.push(rows.slice(i, i + IMPORT_BATCH_SIZE))
      }

      appendLog(`Importing ${rows.length} products in ${batches.length} batches of ${IMPORT_BATCH_SIZE}…`)

      let skuMapEntries: Array<[string, string]> | undefined
      const result: ImportCommitResult = {
        created: 0,
        updated: 0,
        skipped: preview.rows.length - rows.length,
        stockTransactions: 0,
        errors: [],
        backupPath: backupId,
      }

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        appendLog(`Batch ${i + 1}/${batches.length}: sending ${batch.length} rows…`)
        const batchStarted = Date.now()

        const res = await fetch('/api/products/import/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: batch,
            batchIndex: i,
            totalBatches: batches.length,
            skuMapEntries,
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Batch ${i + 1} failed`)

        const batchResult = json.data as {
          created: number
          updated: number
          stockTransactions: number
          errors: ImportCommitResult['errors']
          skuMapEntries: Array<[string, string]>
        }

        skuMapEntries = batchResult.skuMapEntries
        result.created += batchResult.created
        result.updated += batchResult.updated
        result.stockTransactions += batchResult.stockTransactions
        result.errors.push(...batchResult.errors)

        const secs = ((Date.now() - batchStarted) / 1000).toFixed(1)
        appendLog(
          `Batch ${i + 1}/${batches.length} done in ${secs}s — +${batchResult.created} created, +${batchResult.updated} updated`,
        )
      }

      appendLog(
        `Import complete: ${result.created} created, ${result.updated} updated, ${result.stockTransactions} stock entries`,
      )

      setCommitResult(result)
      appendLog('Replacing local IndexedDB catalog from server…')
      setSyncingCatalog(true)
      setSyncProgress(initialSyncProgress())

      const sync = await replaceCatalogFromServer((p) => {
        setSyncProgress(p)
        appendLog(p.message)
      })

      setSyncingCatalog(false)
      setSyncProgress(null)

      if (!sync.ok) {
        appendLog('Warning: local catalog replace failed — hard-refresh the page when online')
        toast.warning('Server import done, but local sync failed — refresh the page')
      } else {
        appendLog(`Local catalog replaced: ${sync.productCount.toLocaleString()} products from server`)
      }

      setStep('done')
      onComplete()
      toast.success(`Imported ${result.created} new, updated ${result.updated}`)
    } catch (err) {
      appendLog(`Error: ${err instanceof Error ? err.message : 'Import failed'}`)
      toast.error(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }

  return (
    <>
    <CatalogSyncOverlay open={syncingCatalog} progress={syncProgress} />
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl w-full max-w-5xl z-50 focus:outline-none max-h-[90vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
            <Dialog.Title className="text-lg font-semibold">Bulk upload products</Dialog.Title>
            <Dialog.Close asChild>
              <button
                disabled={step === 'importing'}
                className="text-gray-500 hover:text-gray-600 rounded-md p-1 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {step === 'upload' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Upload an Excel or CSV export. Default layout matches{' '}
                  <span className="font-medium">STOCK WITH PRICES.xlsx</span>: column A = in stock,
                  B = name, C = category, D = spec/location, F = cost, G = selling price.
                </p>
                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl py-16 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                  {loading ? (
                    <Loader2 size={32} className="text-blue-600 animate-spin" />
                  ) : (
                    <Upload size={32} className="text-gray-400" />
                  )}
                  <span className="text-sm font-medium text-gray-700">
                    {loading ? 'Parsing file…' : 'Drop .xlsx or .csv here, or click to browse'}
                  </span>
                  {file && <span className="text-xs text-gray-500">{file.name}</span>}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="sr-only"
                    disabled={loading}
                    onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            )}

            {step === 'preview' && preview && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Stat label="Total rows" value={preview.summary.total} />
                  <Stat label="New products" value={preview.summary.toCreate} />
                  <Stat label="Updates" value={preview.summary.toUpdate} />
                  <Stat label="Missing prices" value={preview.summary.missingPrice} tone="amber" />
                </div>

                {preview.summary.duplicateNameGroups > 0 && (
                  <p className="text-xs text-blue-700 bg-blue-50 rounded-lg px-3 py-2">
                    Resolved {preview.summary.duplicateNameGroups} duplicate name group(s) using location
                    as spec/variant suffix.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {(['all', 'ok', 'missing_price', 'error', 'create', 'update'] as PreviewFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => { setFilter(f); setPage(1) }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {filterLabel(f)}
                    </button>
                  ))}
                </div>

                <div className="border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-3 py-2">Name</th>
                        <th className="text-left px-3 py-2">Spec / Size</th>
                        <th className="text-left px-3 py-2">SKU</th>
                        <th className="text-left px-3 py-2">Brand</th>
                        <th className="text-left px-3 py-2">Category</th>
                        <th className="text-right px-3 py-2">In stock</th>
                        <th className="text-right px-3 py-2">Selling</th>
                        <th className="text-right px-3 py-2">Buying</th>
                        <th className="text-left px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paginated.map((row) => (
                        <PreviewRow key={`${row.rowIndex}-${row.sku}`} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>

                {filteredRows.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of{' '}
                      {filteredRows.length}
                    </span>
                    <div className="flex gap-1">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="p-1 rounded border border-gray-200 disabled:opacity-40"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="px-2 py-1">{page} / {pageCount}</span>
                      <button
                        disabled={page === pageCount}
                        onClick={() => setPage((p) => p + 1)}
                        className="p-1 rounded border border-gray-200 disabled:opacity-40"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500">
                  A database backup is created automatically before import. Mode: upsert by SKU.
                </p>
              </div>
            )}

            {step === 'importing' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 size={22} className="text-blue-600 animate-spin shrink-0" />
                  <p className="text-sm font-medium text-gray-800">{importProgress || 'Importing…'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-950 text-gray-100 font-mono text-xs max-h-64 overflow-y-auto p-3">
                  {importLogs.map((line, i) => (
                    <div key={i} className="leading-5 whitespace-pre-wrap">{line}</div>
                  ))}
                  <div ref={logEndRef} />
                </div>
                <p className="text-xs text-gray-500">
                  Server logs also print to the terminal running <code className="bg-gray-100 px-1 rounded">npm run dev</code>.
                </p>
              </div>
            )}

            {step === 'done' && commitResult && (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <CheckCircle2 size={48} className="text-green-600" />
                <div>
                  <p className="text-lg font-semibold">Import complete</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {commitResult.created} created · {commitResult.updated} updated ·{' '}
                    {commitResult.stockTransactions} stock entries
                  </p>
                  {commitResult.backupPath && (
                    <p className="text-xs text-gray-500 mt-2">Backup: {commitResult.backupPath}</p>
                  )}
                  {commitResult.errors.length > 0 && (
                    <p className="text-xs text-red-600 mt-2">{commitResult.errors.length} row(s) failed</p>
                  )}
                  {preview && preview.summary.missingPrice > 0 && (
                    <p className="text-xs text-amber-600 mt-3">
                      {preview.summary.missingPrice} product(s) still need prices — use the Missing prices filter on
                      the Products page.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 shrink-0">
            {step === 'preview' && (
              <button
                onClick={() => { setStep('upload'); setPreview(null); setFile(null) }}
                className="text-sm text-gray-600 hover:text-gray-800"
              >
                ← Choose another file
              </button>
            )}
            <div className="ml-auto flex gap-2">
              {step === 'preview' && (
                <button
                  onClick={handleCommit}
                  disabled={!preview || preview.summary.errors > 0}
                  className="inline-flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileSpreadsheet size={16} />
                  Backup &amp; import {preview?.summary.total ?? 0} products
                </button>
              )}
              {step === 'done' && (
                <button
                  onClick={() => handleOpenChange(false)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-semibold ${tone === 'amber' ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function filterLabel(f: PreviewFilter): string {
  const labels: Record<PreviewFilter, string> = {
    all: 'All',
    ok: 'OK',
    missing_price: 'Missing prices',
    error: 'Errors',
    create: 'New',
    update: 'Updates',
  }
  return labels[f]
}

function PreviewRow({ row }: { row: ImportPreviewRow }) {
  const statusClass =
    row.status === 'ok'
      ? 'bg-green-100 text-green-700'
      : row.status === 'missing_price'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700'

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 font-medium">{row.name}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{row.specification ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.sku}</td>
      <td className="px-3 py-2 text-xs text-gray-500 font-medium">{row.brand}</td>
      <td className="px-3 py-2 text-xs text-gray-500">{row.category}</td>
      <td className="px-3 py-2 text-right text-xs">{row.openingStock}</td>
      <td className="px-3 py-2 text-right">{row.sellingPrice > 0 ? row.sellingPrice.toLocaleString() : '—'}</td>
      <td className="px-3 py-2 text-right text-gray-500">
        {row.costPrice > 0 ? row.costPrice.toLocaleString() : '—'}
      </td>
      <td className="px-3 py-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
          {row.action === 'update' ? 'update' : row.status}
        </span>
      </td>
    </tr>
  )
}
