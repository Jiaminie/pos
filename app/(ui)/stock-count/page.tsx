'use client'

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ImagePlus,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { BrandPicker } from '@/components/pos/BrandPicker'
import { CategoryPicker } from '@/components/pos/CategoryPicker'
import { getMyBranchId } from '@/lib/branch'
import { getBrandOptions, getProductBrand, matchesProductSearch } from '@/lib/brands'
import { getAll as getCategories } from '@/lib/db/categories'
import { getAll as getProducts } from '@/lib/db/products'
import { createMany as createManyTx, getAll as getTransactions } from '@/lib/db/transactions'
import { pushMany as pushManyTx, drain } from '@/lib/db/syncQueue'
import { replaceCatalogFromServer, seedIfEmpty, syncFromServer } from '@/lib/db/seed'
import { normalizeQuery } from '@/lib/normalize'
import { barcodeSearchEnabled } from '@/lib/product-search'
import {
  buildUnmatchedReviewRows,
  clearResolvedKeysForUpload,
  computeUploadAggregates,
  draftIdsThatContributedToCounts,
  mergePhotoAggregatesIntoCounts,
  subtractAggregates,
  applyResumeDraftsToCounts,
} from '@/lib/stock-count/aggregate'
import {
  buildAdjustmentTransactions,
  computePendingAdjustments,
  getRowDelta as computeRowDelta,
  round2,
} from '@/lib/stock-count/manual'
import type { ReviewFilter, StockCountUpload } from '@/lib/stock-count/types'
import {
  completeStockCountUploads,
  extractStockCountPhotos,
  fetchResumableDrafts,
  fetchUploadSignature,
  formatStaleAge,
  loadResolvedProductMap,
  parseExtractedRows,
  saveResolvedProductMap,
  STALE_DRAFT_MS,
  uploadToCloudinary,
  validatePhotoFiles,
} from '@/lib/stock-count/upload'
import { fetchSettings, type PosLookupMode } from '@/lib/settings'
import { fetchMe, hasPermission, type AuthUser } from '@/lib/auth'
import { buildStockByProductId } from '@/lib/stock'
import type { InventoryTransaction, Product, ProductCategory } from '@/lib/types'

const PAGE_SIZE = 30

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return String(delta)
  return '0'
}

function reviewStatusLabel(status: ReviewFilter | 'matched' | 'needs_review' | 'unmatched'): string {
  switch (status) {
    case 'all':
      return 'All'
    case 'matched':
      return 'Matched'
    case 'needs_review':
      return 'Needs review'
    case 'unmatched':
      return 'Unmatched'
  }
}

function reviewStatusBadgeClass(status: 'matched' | 'needs_review' | 'unmatched'): string {
  switch (status) {
    case 'matched':
      return 'bg-green-100 text-green-800'
    case 'needs_review':
      return 'bg-amber-100 text-amber-800'
    case 'unmatched':
      return 'bg-red-100 text-red-800'
  }
}

export default function StockCountPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<ProductCategory[]>([])
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [authChecked, setAuthChecked] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('all')
  const [filterBrand, setFilterBrand] = useState('all')
  const [countedQtys, setCountedQtys] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [myBranchId, setMyBranchId] = useState<string | null>(null)
  const [posLookupMode, setPosLookupMode] = useState<PosLookupMode>('catalog')
  const [drafts, setDrafts] = useState<StockCountUpload[]>([])
  const [resolvedByKey, setResolvedByKey] = useState<Record<string, string>>({})
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [pickerSearch, setPickerSearch] = useState<Record<string, string>>({})

  const photoAppliedRef = useRef<Set<string>>(new Set())
  const submittingRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards the persistence effect below from writing an empty {} over storage
  // before the resume-drafts fetch in loadCatalog has had a chance to hydrate it.
  const hydratedResolvedRef = useRef(false)

  function applyUploadAggregatesToCounts(
    upload: StockCountUpload,
    resolved: Record<string, string>,
  ) {
    if (photoAppliedRef.current.has(upload.id)) return
    const aggregates = computeUploadAggregates(upload, products, resolved)
    if (aggregates.size === 0) {
      photoAppliedRef.current.add(upload.id)
      return
    }
    setCountedQtys((prev) => mergePhotoAggregatesIntoCounts(prev, aggregates))
    photoAppliedRef.current.add(upload.id)
  }

  async function loadCatalog(runSync = true) {
    let [cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
    if (prods.length === 0) {
      await seedIfEmpty()
      ;[cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
      if (prods.length === 0) {
        const sync = await replaceCatalogFromServer()
        if (sync.ok) {
          ;[cats, prods, txs] = await Promise.all([getCategories(), getProducts(), getTransactions()])
        }
      }
    }
    setCategories(cats)
    setProducts(prods)
    setTransactions(txs)
    setLoading(false)

    const branchId = getMyBranchId()
    if (branchId) {
      try {
        const resume = await fetchResumableDrafts(branchId)
        setDrafts(resume)
        // Restore any rows the user had already manually resolved before the
        // page reloaded — otherwise resuming would drop their quantities and
        // put those rows back in the review queue with no warning.
        const resolvedFromStorage = loadResolvedProductMap(branchId)
        if (Object.keys(resolvedFromStorage).length > 0) {
          setResolvedByKey((prev) => ({ ...resolvedFromStorage, ...prev }))
        }
        const resumeAggregates = applyResumeDraftsToCounts(resume, prods, resolvedFromStorage)
        if (resumeAggregates.size > 0) {
          setCountedQtys((prev) => mergePhotoAggregatesIntoCounts(prev, resumeAggregates))
        }
        for (const upload of resume) {
          if (upload.status === 'EXTRACTED') {
            photoAppliedRef.current.add(upload.id)
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load photo drafts')
      } finally {
        hydratedResolvedRef.current = true
      }
    }

    if (!runSync) return

    void syncFromServer().then(async (synced) => {
      if (!synced) return
      const [nextCats, nextProds, nextTxs] = await Promise.all([
        getCategories(),
        getProducts(),
        getTransactions(),
      ])
      setCategories(nextCats)
      setProducts(nextProds)
      setTransactions(nextTxs)
    })
  }

  useEffect(() => {
    setMyBranchId(getMyBranchId())
    void fetchMe().then((user) => {
      setAuthUser(user)
      setAuthChecked(true)
    })
    void loadCatalog()
    fetchSettings()
      .then((s) => setPosLookupMode(s.posLookupMode))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!myBranchId || !hydratedResolvedRef.current) return
    saveResolvedProductMap(myBranchId, resolvedByKey)
  }, [resolvedByKey, myBranchId])

  const categoryMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const p of products) counts[p.categoryId] = (counts[p.categoryId] ?? 0) + 1
    return counts
  }, [products])

  const brands = useMemo(() => getBrandOptions(products), [products])

  const brandCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length }
    for (const product of products) {
      const brand = getProductBrand(product)
      counts[brand] = (counts[brand] ?? 0) + 1
    }
    return counts
  }, [products])

  const deferredSearch = useDeferredValue(search)
  const nq = normalizeQuery(deferredSearch.trim())
  const showBarcodeField = barcodeSearchEnabled(posLookupMode)

  const stockByProductId = useMemo(
    () => buildStockByProductId(products, transactions, myBranchId ?? undefined),
    [products, transactions, myBranchId],
  )

  const unmatchedRows = useMemo(
    () => buildUnmatchedReviewRows(drafts, products, resolvedByKey),
    [drafts, products, resolvedByKey],
  )

  const filteredReviewRows = useMemo(() => {
    if (reviewFilter === 'all') return unmatchedRows
    return unmatchedRows.filter((row) => row.status === reviewFilter)
  }, [unmatchedRows, reviewFilter])

  const staleDrafts = useMemo(
    () => drafts.filter((d) => Date.now() - new Date(d.createdAt).getTime() > STALE_DRAFT_MS),
    [drafts],
  )

  const visible = useMemo(() => {
    return products
      .filter((product) => filterCategoryId === 'all' || product.categoryId === filterCategoryId)
      .filter((product) => filterBrand === 'all' || getProductBrand(product) === filterBrand)
      .filter((product) =>
        matchesProductSearch(product, nq, categoryMap[product.categoryId] ?? '', {
          includeBarcode: showBarcodeField,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [products, filterCategoryId, filterBrand, nq, categoryMap, showBarcodeField])

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const paginated = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const pendingAdjustments = useMemo(
    () => computePendingAdjustments(products, countedQtys, stockByProductId),
    [products, countedQtys, stockByProductId],
  )

  function handleSearch(q: string) {
    setSearch(q)
    setPage(1)
  }

  function getRowDelta(productId: string, initialStock = 0): number | null {
    return computeRowDelta(productId, countedQtys, stockByProductId, initialStock)
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const fileList = e.target.files
    if (!fileList || fileList.length === 0) return

    const branchId = getMyBranchId()
    if (!branchId) {
      toast.error('Branch is not set')
      return
    }

    const files = Array.from(fileList)
    const validationError = validatePhotoFiles(files)
    if (validationError) {
      toast.error(validationError)
      e.target.value = ''
      return
    }

    setUploading(true)
    try {
      const signature = await fetchUploadSignature()
      const urls = await Promise.all(files.map((file) => uploadToCloudinary(file, signature)))
      const uploads = await extractStockCountPhotos(
        branchId,
        urls.map((url, index) => ({ url, filename: files[index]?.name })),
      )

      setDrafts((prev) => [...uploads, ...prev.filter((d) => !uploads.some((u) => u.id === d.id))])

      for (const upload of uploads) {
        applyUploadAggregatesToCounts(upload, resolvedByKey)
      }

      const errors = uploads.filter((u) => u.status === 'ERROR')
      const ok = uploads.filter((u) => u.status === 'EXTRACTED')
      if (ok.length > 0) {
        toast.success(`Extracted ${ok.length} photo${ok.length === 1 ? '' : 's'}`)
      }
      if (errors.length > 0) {
        toast.warning(
          `${errors.length} photo${errors.length === 1 ? '' : 's'} failed extraction — review below`,
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Photo upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleDiscardDraft(uploadId: string) {
    const branchId = getMyBranchId()
    if (!branchId) return

    const upload = drafts.find((d) => d.id === uploadId)
    if (!upload) return

    try {
      await completeStockCountUploads(branchId, [uploadId], 'DISCARDED')
      const aggregates = computeUploadAggregates(upload, products, resolvedByKey)
      setCountedQtys((prev) => subtractAggregates(prev, aggregates))
      setResolvedByKey((prev) => clearResolvedKeysForUpload(prev, uploadId))
      photoAppliedRef.current.delete(uploadId)
      setDrafts((prev) => prev.filter((d) => d.id !== uploadId))
      toast.success('Photo draft discarded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Discard failed')
    }
  }

  function handleResolveRow(key: string, productId: string, qty: number) {
    setResolvedByKey((prev) => ({ ...prev, [key]: productId }))
    setCountedQtys((prev) =>
      mergePhotoAggregatesIntoCounts(prev, new Map([[productId, round2(qty)]])),
    )
  }

  async function handleSubmit() {
    if (submittingRef.current || pendingAdjustments.length === 0) return

    const branchId = getMyBranchId()
    if (!branchId) {
      toast.error('Branch is not set')
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const txs = buildAdjustmentTransactions(pendingAdjustments, branchId)

      await createManyTx(txs)
      // Local write succeeded — reflect it immediately. If a step below throws,
      // a retry then recomputes deltas against the already-updated stock instead
      // of re-submitting the same adjustment under a fresh id (double-counting it).
      setTransactions((prev) => [...txs, ...prev])
      setCountedQtys((prev) => {
        const next = { ...prev }
        for (const { productId } of pendingAdjustments) delete next[productId]
        return next
      })

      await pushManyTx(txs)
      const { droppedIds } = await drain().catch(() => ({ droppedIds: [] as string[] }))
      if (droppedIds.length > 0) {
        setTransactions((prev) => prev.filter((t) => !droppedIds.includes(t.id)))
      }

      const contributingDraftIds = draftIdsThatContributedToCounts(
        drafts,
        products,
        resolvedByKey,
      )

      if (contributingDraftIds.length > 0) {
        try {
          await completeStockCountUploads(branchId, contributingDraftIds, 'SUBMITTED')
          setDrafts((prev) => prev.filter((d) => !contributingDraftIds.includes(d.id)))
          setResolvedByKey((prev) => {
            let next = prev
            for (const id of contributingDraftIds) {
              next = clearResolvedKeysForUpload(next, id)
            }
            return next
          })
          for (const id of contributingDraftIds) {
            photoAppliedRef.current.delete(id)
          }
        } catch {
          toast.warning('Count saved, but photo draft cleanup failed — you may see old drafts on reload')
        }
      }

      toast.success('Stock count submitted', {
        description: `${txs.length} adjustment${txs.length === 1 ? '' : 's'} recorded`,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  function pageNumbers(): (number | '…')[] {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
    if (page <= 4) return [1, 2, 3, 4, 5, '…', pageCount]
    if (page >= pageCount - 3) {
      return [1, '…', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
    }
    return [1, '…', page - 1, page, page + 1, '…', pageCount]
  }

  function productPickerOptions(query: string): Product[] {
    const q = normalizeQuery(query.trim())
    if (!q) return products.slice(0, 20)
    return products
      .filter((p) =>
        matchesProductSearch(p, q, categoryMap[p.categoryId] ?? '', {
          includeBarcode: showBarcodeField,
        }),
      )
      .slice(0, 20)
  }

  if (!authChecked || loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading catalog…
      </div>
    )
  }

  if (!authUser || !hasPermission(authUser, 'stock.count.adjust')) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center text-gray-500">
        <ClipboardList size={32} className="mb-3 opacity-40" />
        <p className="text-sm font-medium text-gray-800">Stock count is not available for your role</p>
        <p className="text-xs mt-1 max-w-sm">
          This page requires the stock count permission. Contact a manager if you need access.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 md:px-4 md:py-6 min-w-0 pb-28 md:pb-6">
      <div className="w-full max-w-6xl mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5 md:mb-6">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
              <ClipboardList size={22} className="text-blue-600 shrink-0" />
              Stock Count
            </h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              Type counts directly or upload handwritten form photos
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || pendingAdjustments.length === 0}
            className="inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm w-full md:w-auto"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                Submit count
                {pendingAdjustments.length > 0 && (
                  <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs">
                    {pendingAdjustments.length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>

        {staleDrafts.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              {staleDrafts.length} photo draft{staleDrafts.length === 1 ? '' : 's'} extracted{' '}
              {formatStaleAge(staleDrafts[0]!.createdAt)} — recent sales or restocks may make
              variances stale. Review carefully before submitting.
            </div>
          </div>
        )}

        {pendingAdjustments.length > 0 && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {pendingAdjustments.length} product{pendingAdjustments.length === 1 ? '' : 's'} with
            non-zero variance ready to submit.
          </div>
        )}

        <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Photo-assisted entry</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Upload handwritten forms (JPEG/PNG/WebP, max 5 MB each, up to 10 per batch)
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                id="stock-count-photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                multiple
                className="sr-only"
                aria-label="Upload stock count form photos"
                onChange={(e) => void handlePhotoSelect(e)}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-800 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 w-full sm:w-auto"
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <ImagePlus size={16} />
                    Add photos
                  </>
                )}
              </button>
            </div>
          </div>

          {drafts.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {drafts.map((draft) => (
                <div
                  key={draft.id}
                  className="flex gap-3 rounded-lg border border-gray-200 bg-white p-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={draft.imageUrl}
                    alt="Stock count form"
                    className="w-16 h-16 rounded-lg object-cover ring-1 ring-gray-200 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-800 truncate">
                      {draft.status === 'EXTRACTED'
                        ? `${parseExtractedRows(draft.extractedRows).length} rows extracted`
                        : draft.status === 'ERROR'
                          ? 'Extraction failed'
                          : draft.status === 'PENDING'
                            ? 'Processing…'
                            : draft.status}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      {formatStaleAge(draft.createdAt)}
                    </p>
                    {draft.status === 'ERROR' && draft.errorMessage && (
                      <p className="text-[10px] text-red-600 mt-1 line-clamp-2">{draft.errorMessage}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDiscardDraft(draft.id)}
                    title="Discard this photo"
                    aria-label="Discard this photo"
                    className="shrink-0 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {unmatchedRows.length > 0 && (
          <div className="mb-5 rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900">Extracted rows needing review</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Resolve unmatched or low-confidence rows before submitting
              </p>
              <div className="flex flex-wrap gap-1 mt-3">
                {(['all', 'needs_review', 'unmatched'] as ReviewFilter[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setReviewFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      reviewFilter === f
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {reviewStatusLabel(f)}
                    {f !== 'all' && (
                      <span className="ml-1 opacity-80">
                        ({unmatchedRows.filter((r) => r.status === f).length})
                      </span>
                    )}
                    {f === 'all' && (
                      <span className="ml-1 opacity-80">({unmatchedRows.length})</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {filteredReviewRows.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">No rows in this filter</p>
              ) : (
                filteredReviewRows.map((item) => {
                  const query = pickerSearch[item.key] ?? item.row.description
                  const options = productPickerOptions(query)
                  return (
                    <div key={item.key} className="p-4 flex flex-col md:flex-row md:items-start gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="w-12 h-12 rounded object-cover ring-1 ring-gray-200 shrink-0 hidden md:block"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${reviewStatusBadgeClass(item.status)}`}
                          >
                            {reviewStatusLabel(item.status)}
                          </span>
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {item.row.description}
                          </span>
                          <span className="text-sm tabular-nums text-gray-600">× {item.row.qty}</span>
                        </div>
                        {item.suggestedProductName && (
                          <p className="text-xs text-gray-500 mb-2">
                            Suggested: {item.suggestedProductName}
                          </p>
                        )}
                        <div className="relative max-w-md">
                          <Search
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                          />
                          <input
                            type="text"
                            value={query}
                            onChange={(e) =>
                              setPickerSearch((prev) => ({ ...prev, [item.key]: e.target.value }))
                            }
                            placeholder="Search products to link this row…"
                            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        {query.trim() && options.length > 0 && (
                          <ul className="mt-1 max-w-md border border-gray-200 rounded-lg bg-white shadow-sm max-h-40 overflow-y-auto">
                            {options.map((product) => (
                              <li key={product.id}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleResolveRow(item.key, product.id, item.row.qty)
                                    setPickerSearch((prev) => {
                                      const next = { ...prev }
                                      delete next[item.key]
                                      return next
                                    })
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 truncate"
                                >
                                  {product.name}
                                  {product.specification ? (
                                    <span className="text-gray-500"> · {product.specification}</span>
                                  ) : null}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch mb-3">
          <div className="relative flex-1 min-w-0 w-full">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by name, SKU, brand, category or specification…"
              className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 focus:bg-white transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => handleSearch('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {(categories.length > 0 || brands.length > 0) && (
            <div
              className={`grid gap-2 min-w-0 sm:flex sm:shrink-0 ${
                categories.length > 0 && brands.length > 0 ? 'grid-cols-2' : 'grid-cols-1'
              }`}
            >
              {categories.length > 0 && (
                <CategoryPicker
                  categories={categories}
                  counts={categoryCounts}
                  value={filterCategoryId}
                  onChange={(id) => {
                    setFilterCategoryId(id)
                    setPage(1)
                  }}
                />
              )}
              {brands.length > 0 && (
                <BrandPicker
                  brands={brands}
                  counts={brandCounts}
                  value={filterBrand}
                  onChange={(brand) => {
                    setFilterBrand(brand)
                    setPage(1)
                  }}
                />
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 mb-4">
          {visible.length.toLocaleString()} product{visible.length === 1 ? '' : 's'}
          {filterBrand !== 'all' ? ` · ${filterBrand}` : ''}
        </p>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <Camera size={32} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No products match your filters</p>
            {(search || filterCategoryId !== 'all' || filterBrand !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  handleSearch('')
                  setFilterCategoryId('all')
                  setFilterBrand('all')
                }}
                className="mt-2 text-xs text-blue-600 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3">Product</th>
                      <th className="text-left px-4 py-3">Spec</th>
                      <th className="text-left px-4 py-3">Brand</th>
                      <th className="text-right px-4 py-3">System stock</th>
                      <th className="text-right px-4 py-3 w-32">Counted qty</th>
                      <th className="text-right px-4 py-3 w-24">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginated.map((product) => {
                      const system = stockByProductId[product.id] ?? product.initialStock ?? 0
                      const delta = getRowDelta(product.id, product.initialStock ?? 0)
                      return (
                        <tr key={product.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium truncate max-w-[200px]" title={product.name}>
                            {product.name}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500 truncate max-w-[120px]">
                            {product.specification ?? '—'}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 truncate max-w-[100px]">
                            {getProductBrand(product)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{system}</td>
                          <td className="px-4 py-2.5">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="any"
                              min="0"
                              value={countedQtys[product.id] ?? ''}
                              onChange={(e) =>
                                setCountedQtys((prev) => ({ ...prev, [product.id]: e.target.value }))
                              }
                              placeholder="—"
                              className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                              delta === null
                                ? 'text-gray-300'
                                : delta > 0
                                  ? 'text-green-600'
                                  : delta < 0
                                    ? 'text-red-600'
                                    : 'text-gray-500'
                            }`}
                          >
                            {delta === null ? '—' : formatDelta(delta)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-gray-100">
                {paginated.map((product) => {
                  const system = stockByProductId[product.id] ?? product.initialStock ?? 0
                  const delta = getRowDelta(product.id, product.initialStock ?? 0)
                  return (
                    <div key={product.id} className="p-4 space-y-2">
                      <div>
                        <p className="font-medium text-sm">{product.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[product.specification, getProductBrand(product)].filter(Boolean).join(' · ') ||
                            '—'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-gray-500">
                          System: <span className="font-medium text-gray-800 tabular-nums">{system}</span>
                        </span>
                        <span
                          className={`tabular-nums font-medium ${
                            delta === null
                              ? 'text-gray-300'
                              : delta > 0
                                ? 'text-green-600'
                                : delta < 0
                                  ? 'text-red-600'
                                  : 'text-gray-500'
                          }`}
                        >
                          Δ {delta === null ? '—' : formatDelta(delta)}
                        </span>
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={countedQtys[product.id] ?? ''}
                        onChange={(e) =>
                          setCountedQtys((prev) => ({ ...prev, [product.id]: e.target.value }))
                        }
                        placeholder="Counted qty"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )
                })}
              </div>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-1 mt-4">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft size={18} />
                </button>
                {pageNumbers().map((n, i) =>
                  n === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={`min-w-8 px-2 py-1 rounded-lg text-sm ${
                        page === n ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {n}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
