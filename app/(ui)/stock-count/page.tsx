'use client'

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ImagePlus,
  Loader2,
  Link2,
  PackagePlus,
  Pencil,
  Search,
  SkipForward,
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
import { matchProduct } from '@/lib/stock-count/match'
import {
  buildAdjustmentTransactions,
  computePendingAdjustments,
  getRowDelta as computeRowDelta,
  round2,
} from '@/lib/stock-count/manual'
import { createStockCountProduct } from '@/lib/stock-count/newProduct'
import type {
  ExtractedStockCountRow,
  ReviewFilter,
  StockCountUpload,
  UnmatchedReviewRow,
} from '@/lib/stock-count/types'
import {
  completeStockCountUploads,
  extractStockCountPhotos,
  fetchResumableDrafts,
  fetchUploadSignature,
  formatStaleAge,
  hashFile,
  loadDismissedRowKeys,
  loadResolvedProductMap,
  loadRowEdits,
  loadUploadedHashes,
  parseExtractedRows,
  saveDismissedRowKeys,
  saveResolvedProductMap,
  saveRowEdits,
  saveUploadedHashes,
  STALE_DRAFT_MS,
  uploadToCloudinary,
  validatePhotoFiles,
} from '@/lib/stock-count/upload'
import { fetchSettings, type PosLookupMode } from '@/lib/settings'
import { fetchMe, hasPermission, type AuthUser } from '@/lib/auth'
import { buildStockByProductId } from '@/lib/stock'
import type { InventoryTransaction, Product, ProductCategory } from '@/lib/types'

const PAGE_SIZE = 30

type NewItemForm = {
  name: string
  sellingPrice: string
  costPrice: string
  categoryId: string
  brand: string
  specification: string
}

const emptyNewItemForm: NewItemForm = {
  name: '',
  sellingPrice: '',
  costPrice: '',
  categoryId: '',
  brand: '',
  specification: '',
}

type EditRowForm = {
  description: string
  qty: string
  sizeType: string
  company: string
}

const emptyEditForm: EditRowForm = { description: '', qty: '', sizeType: '', company: '' }

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
  const [dismissedKeys, setDismissedKeys] = useState<Record<string, true>>({})
  const [uploadedHashes, setUploadedHashes] = useState<Record<string, string>>({})
  const [activeTab, setActiveTab] = useState<'count' | 'photos'>('count')
  const [showCountedOnly, setShowCountedOnly] = useState(false)
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [reviewImageFilter, setReviewImageFilter] = useState<string>('all')
  const [pickerSearch, setPickerSearch] = useState<Record<string, string>>({})
  const [openPickerKey, setOpenPickerKey] = useState<string | null>(null)
  const [newItemKey, setNewItemKey] = useState<string | null>(null)
  const [newItemForm, setNewItemForm] = useState<NewItemForm>(emptyNewItemForm)
  const [creatingItem, setCreatingItem] = useState(false)
  const [rowEdits, setRowEdits] = useState<Record<string, ExtractedStockCountRow>>({})
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditRowForm>(emptyEditForm)

  const photoAppliedRef = useRef<Set<string>>(new Set())
  const submittingRef = useRef(false)
  const creatingItemRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Guards the persistence effect below from writing an empty {} over storage
  // before the resume-drafts fetch in loadCatalog has had a chance to hydrate it.
  const hydratedResolvedRef = useRef(false)

  function applyUploadAggregatesToCounts(
    upload: StockCountUpload,
    resolved: Record<string, string>,
  ) {
    if (photoAppliedRef.current.has(upload.id)) return
    const aggregates = computeUploadAggregates(upload, products, resolved, rowEdits)
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
        const dismissedFromStorage = loadDismissedRowKeys(branchId)
        if (Object.keys(dismissedFromStorage).length > 0) {
          setDismissedKeys((prev) => ({ ...dismissedFromStorage, ...prev }))
        }
        const editsFromStorage = loadRowEdits(branchId)
        if (Object.keys(editsFromStorage).length > 0) {
          setRowEdits((prev) => ({ ...editsFromStorage, ...prev }))
        }
        // Keep only dedup hashes whose upload is still in the active count —
        // submitted/discarded/expired drafts drop out, so re-uploading their
        // image later is allowed and the map stays bounded.
        const resumeIds = new Set(resume.map((d) => d.id))
        const prunedHashes: Record<string, string> = {}
        for (const [hash, id] of Object.entries(loadUploadedHashes(branchId))) {
          if (resumeIds.has(id)) prunedHashes[hash] = id
        }
        setUploadedHashes(prunedHashes)
        const resumeAggregates = applyResumeDraftsToCounts(
          resume,
          prods,
          resolvedFromStorage,
          editsFromStorage,
        )
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

  useEffect(() => {
    if (!myBranchId || !hydratedResolvedRef.current) return
    saveDismissedRowKeys(myBranchId, dismissedKeys)
  }, [dismissedKeys, myBranchId])

  useEffect(() => {
    if (!myBranchId || !hydratedResolvedRef.current) return
    saveUploadedHashes(myBranchId, uploadedHashes)
  }, [uploadedHashes, myBranchId])

  useEffect(() => {
    if (!myBranchId || !hydratedResolvedRef.current) return
    saveRowEdits(myBranchId, rowEdits)
  }, [rowEdits, myBranchId])

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

  // Field-level product permissions. name/brand/category/spec are covered by
  // catalog.product.manage; each price has its own permission. Creating needs the
  // required fields (manage + a selling price); cost is optional, so its field is
  // hidden — not blocking — for users without cost permission.
  const canManageProducts = hasPermission(authUser, 'catalog.product.manage')
  const canSetSellingPrice = hasPermission(authUser, 'catalog.price.selling')
  const canSetCostPrice = hasPermission(authUser, 'catalog.price.cost_and_floor')
  const canCreateProduct = canManageProducts && canSetSellingPrice

  const stockByProductId = useMemo(
    () => buildStockByProductId(products, transactions, myBranchId ?? undefined),
    [products, transactions, myBranchId],
  )

  const unmatchedRows = useMemo(
    () =>
      buildUnmatchedReviewRows(drafts, products, resolvedByKey)
        .filter((row) => !dismissedKeys[row.key])
        .map((row) => {
          const edit = rowEdits[row.key]
          if (!edit) return row
          // Re-match on the corrected text so fixing a typo can surface the
          // right suggestion; keep the row in the queue for explicit confirm.
          const match = matchProduct(edit.description, products)
          return {
            ...row,
            row: edit,
            status: match.status,
            suggestedProductId: match.productId,
            suggestedProductName: match.productName,
          }
        }),
    [drafts, products, resolvedByKey, dismissedKeys, rowEdits],
  )

  // One entry per source photo that still has rows needing review, in draft order.
  const reviewImageGroups = useMemo(() => {
    const byUpload = new Map<string, { uploadId: string; imageUrl: string; count: number }>()
    for (const row of unmatchedRows) {
      const existing = byUpload.get(row.uploadId)
      if (existing) existing.count++
      else byUpload.set(row.uploadId, { uploadId: row.uploadId, imageUrl: row.imageUrl, count: 1 })
    }
    const order = new Map(drafts.map((d, i) => [d.id, i]))
    return [...byUpload.values()].sort(
      (a, b) => (order.get(a.uploadId) ?? 0) - (order.get(b.uploadId) ?? 0),
    )
  }, [unmatchedRows, drafts])

  // Ignore an image filter whose photo no longer has rows (e.g. all resolved).
  const activeImageFilter =
    reviewImageFilter !== 'all' && reviewImageGroups.some((g) => g.uploadId === reviewImageFilter)
      ? reviewImageFilter
      : 'all'

  // Counts on each filter dimension reflect the OTHER dimension's active choice,
  // so e.g. the status tabs show counts within the selected photo (not global).
  const imageScopedRows = useMemo(
    () =>
      activeImageFilter === 'all'
        ? unmatchedRows
        : unmatchedRows.filter((row) => row.uploadId === activeImageFilter),
    [unmatchedRows, activeImageFilter],
  )
  const statusScopedRows = useMemo(
    () =>
      reviewFilter === 'all'
        ? unmatchedRows
        : unmatchedRows.filter((row) => row.status === reviewFilter),
    [unmatchedRows, reviewFilter],
  )

  const filteredReviewRows = useMemo(() => {
    return unmatchedRows.filter(
      (row) =>
        (reviewFilter === 'all' || row.status === reviewFilter) &&
        (activeImageFilter === 'all' || row.uploadId === activeImageFilter),
    )
  }, [unmatchedRows, reviewFilter, activeImageFilter])

  const staleDrafts = useMemo(
    () => drafts.filter((d) => Date.now() - new Date(d.createdAt).getTime() > STALE_DRAFT_MS),
    [drafts],
  )

  // Products the user has actually entered a count for (typed or photo-derived).
  const countedProductIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, value] of Object.entries(countedQtys)) {
      if (value?.trim()) ids.add(id)
    }
    return ids
  }, [countedQtys])

  const visible = useMemo(() => {
    return products
      .filter((product) => !showCountedOnly || countedProductIds.has(product.id))
      .filter((product) => filterCategoryId === 'all' || product.categoryId === filterCategoryId)
      .filter((product) => filterBrand === 'all' || getProductBrand(product) === filterBrand)
      .filter((product) =>
        matchesProductSearch(product, nq, categoryMap[product.categoryId] ?? '', {
          includeBarcode: showBarcodeField,
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [
    products,
    showCountedOnly,
    countedProductIds,
    filterCategoryId,
    filterBrand,
    nq,
    categoryMap,
    showBarcodeField,
  ])

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
      // Drop images already in this count (or repeated within this selection)
      // before spending an upload + Claude call on them.
      const hashes = await Promise.all(files.map((file) => hashFile(file)))
      const batchSeen = new Set<string>()
      const toUpload: File[] = []
      const toUploadHashes: string[] = []
      let skipped = 0
      files.forEach((file, i) => {
        const hash = hashes[i]!
        if (uploadedHashes[hash] || batchSeen.has(hash)) {
          skipped++
          return
        }
        batchSeen.add(hash)
        toUpload.push(file)
        toUploadHashes.push(hash)
      })

      if (skipped > 0) {
        toast.warning(
          `${skipped} duplicate photo${skipped === 1 ? '' : 's'} skipped (already added to this count)`,
        )
      }
      if (toUpload.length === 0) return

      const signature = await fetchUploadSignature()
      const urls = await Promise.all(toUpload.map((file) => uploadToCloudinary(file, signature)))
      const uploads = await extractStockCountPhotos(
        branchId,
        urls.map((url, index) => ({ url, filename: toUpload[index]?.name })),
      )

      setDrafts((prev) => [...uploads, ...prev.filter((d) => !uploads.some((u) => u.id === d.id))])

      for (const upload of uploads) {
        applyUploadAggregatesToCounts(upload, resolvedByKey)
      }

      // Record hash → upload id (extract preserves input order) so a later
      // re-selection of the same file is recognised.
      setUploadedHashes((prev) => {
        const next = { ...prev }
        uploads.forEach((u, i) => {
          const hash = toUploadHashes[i]
          if (hash) next[hash] = u.id
        })
        return next
      })

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
      const aggregates = computeUploadAggregates(upload, products, resolvedByKey, rowEdits)
      setCountedQtys((prev) => subtractAggregates(prev, aggregates))
      setResolvedByKey((prev) => clearResolvedKeysForUpload(prev, uploadId))
      setRowEdits((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${uploadId}:`)) delete next[key]
        }
        return next
      })
      // Free the dedup hash so re-uploading this image is allowed after discard.
      setUploadedHashes((prev) => {
        const next = { ...prev }
        for (const hash of Object.keys(next)) {
          if (next[hash] === uploadId) delete next[hash]
        }
        return next
      })
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
    setPickerSearch((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    setOpenPickerKey((cur) => (cur === key ? null : cur))
  }

  function handleSkipRow(key: string) {
    setDismissedKeys((prev) => ({ ...prev, [key]: true }))
    setOpenPickerKey((cur) => (cur === key ? null : cur))
    toast('Row skipped — it won’t be counted', {
      action: {
        label: 'Undo',
        onClick: () =>
          setDismissedKeys((prev) => {
            const next = { ...prev }
            delete next[key]
            return next
          }),
      },
    })
  }

  function handleAcceptSuggestion(item: UnmatchedReviewRow) {
    if (!item.suggestedProductId) return
    handleResolveRow(item.key, item.suggestedProductId, item.row.qty)
  }

  function openEdit(item: UnmatchedReviewRow) {
    setOpenPickerKey(null)
    setNewItemKey(null)
    setEditForm({
      description: item.row.description,
      qty: String(item.row.qty),
      sizeType: item.row.sizeType ?? '',
      company: item.row.company ?? '',
    })
    setEditKey(item.key)
  }

  function closeEdit() {
    setEditKey(null)
    setEditForm(emptyEditForm)
  }

  function handleSaveEdit(item: UnmatchedReviewRow) {
    const description = editForm.description.trim()
    if (!description) {
      toast.error('Description is required')
      return
    }
    const qty = parseFloat(editForm.qty)
    if (Number.isNaN(qty) || qty < 0) {
      toast.error('Enter a valid quantity')
      return
    }
    const edited: ExtractedStockCountRow = {
      ...item.row,
      description,
      qty: round2(qty),
      sizeType: editForm.sizeType.trim() || null,
      company: editForm.company.trim() || null,
    }
    setRowEdits((prev) => ({ ...prev, [item.key]: edited }))
    closeEdit()
  }

  function openNewItem(item: UnmatchedReviewRow) {
    setOpenPickerKey(null)
    setEditKey(null)
    setNewItemForm({
      ...emptyNewItemForm,
      name: item.row.description,
      specification: item.row.sizeType ?? '',
      brand: item.row.company ?? '',
    })
    setNewItemKey(item.key)
  }

  function closeNewItem() {
    setNewItemKey(null)
    setNewItemForm(emptyNewItemForm)
  }

  async function handleCreateNewItem(item: UnmatchedReviewRow) {
    // Ref guard closes the double-click window before `creatingItem` state (and
    // the button's disabled attr) has re-rendered — otherwise two fast clicks
    // could create two products for one row.
    if (creatingItemRef.current) return
    const name = newItemForm.name.trim()
    if (!name) {
      toast.error('Product name is required')
      return
    }
    const sellingPrice = parseFloat(newItemForm.sellingPrice)
    if (Number.isNaN(sellingPrice) || sellingPrice < 0) {
      toast.error('Enter a selling price')
      return
    }
    // Only include cost when the user is allowed to set it (otherwise the field
    // is hidden and the server defaults the stored cost to 0).
    let costPrice: number | undefined
    if (canSetCostPrice && newItemForm.costPrice.trim()) {
      costPrice = parseFloat(newItemForm.costPrice)
      if (Number.isNaN(costPrice) || costPrice < 0) {
        toast.error('Cost price is not a valid number')
        return
      }
    }

    creatingItemRef.current = true
    setCreatingItem(true)
    try {
      const product = await createStockCountProduct(
        {
          name,
          sellingPrice,
          costPrice,
          categoryId: newItemForm.categoryId || undefined,
          categoryName: categories.find((c) => c.id === newItemForm.categoryId)?.name ?? null,
          brand: newItemForm.brand,
          specification: newItemForm.specification,
        },
        products.map((p) => p.sku),
      )
      setProducts((prev) => [product, ...prev])
      // Link the row to the new product — its counted qty then flows through the
      // normal submit as an ADJUSTMENT (new product's system stock is 0).
      handleResolveRow(item.key, product.id, item.row.qty)
      closeNewItem()
      toast.success(`Added “${product.name}” and counted ${item.row.qty}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create product')
    } finally {
      creatingItemRef.current = false
      setCreatingItem(false)
    }
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
        rowEdits,
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
          setRowEdits((prev) => {
            const next = { ...prev }
            for (const key of Object.keys(next)) {
              if (contributingDraftIds.some((id) => key.startsWith(`${id}:`))) delete next[key]
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

  // Inline product search used both in the desktop expanded row and mobile card
  // to link a review row to a different product than the suggested one.
  function renderProductPicker(item: UnmatchedReviewRow) {
    const query = pickerSearch[item.key] ?? item.row.description
    const options = productPickerOptions(query)
    return (
      <div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setPickerSearch((prev) => ({ ...prev, [item.key]: e.target.value }))}
            placeholder="Search products to link this row…"
            className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {query.trim() && options.length > 0 && (
          <ul className="mt-1 border border-gray-200 rounded-lg bg-white shadow-sm max-h-48 overflow-y-auto">
            {options.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => handleResolveRow(item.key, product.id, item.row.qty)}
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
    )
  }

  function renderNewItemForm(item: UnmatchedReviewRow) {
    const set = (patch: Partial<NewItemForm>) => setNewItemForm((f) => ({ ...f, ...patch }))
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-xs font-medium text-gray-700 mb-2">
          New product · counts {item.row.qty} on submit
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 sm:col-span-2">
            Name
            <input
              type="text"
              value={newItemForm.name}
              onChange={(e) => set({ name: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs text-gray-500">
            Selling price <span className="text-red-500">*</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={newItemForm.sellingPrice}
              onChange={(e) => set({ sellingPrice: e.target.value })}
              placeholder="0.00"
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          {canSetCostPrice && (
            <label className="text-xs text-gray-500">
              Cost price <span className="text-gray-400">(optional)</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={newItemForm.costPrice}
                onChange={(e) => set({ costPrice: e.target.value })}
                placeholder="0.00"
                className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          )}
          <label className="text-xs text-gray-500">
            Category <span className="text-gray-400">(optional)</span>
            <select
              value={newItemForm.categoryId}
              onChange={(e) => set({ categoryId: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Uncategorized (set later)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-500">
            Brand <span className="text-gray-400">(optional)</span>
            <input
              type="text"
              value={newItemForm.brand}
              onChange={(e) => set({ brand: e.target.value })}
              placeholder="UNBRANDED"
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            disabled={creatingItem}
            onClick={() => void handleCreateNewItem(item)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creatingItem ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
            Create &amp; count
          </button>
          <button
            type="button"
            onClick={closeNewItem}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 text-gray-600 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  function renderEditForm(item: UnmatchedReviewRow) {
    const set = (patch: Partial<EditRowForm>) => setEditForm((f) => ({ ...f, ...patch }))
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-xs font-medium text-gray-700 mb-2">
          Correct what was read from the photo
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 sm:col-span-2">
            Description
            <input
              type="text"
              value={editForm.description}
              onChange={(e) => set({ description: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs text-gray-500">
            Quantity
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={editForm.qty}
              onChange={(e) => set({ qty: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs text-gray-500">
            Size / type <span className="text-gray-400">(optional)</span>
            <input
              type="text"
              value={editForm.sizeType}
              onChange={(e) => set({ sizeType: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="text-xs text-gray-500">
            Company / brand <span className="text-gray-400">(optional)</span>
            <input
              type="text"
              value={editForm.company}
              onChange={(e) => set({ company: e.target.value })}
              className="mt-0.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => handleSaveEdit(item)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700"
          >
            <Check size={14} /> Save correction
          </button>
          <button
            type="button"
            onClick={closeEdit}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 text-gray-600 px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  function renderReviewRow(item: UnmatchedReviewRow) {
    const pickerOpen = openPickerKey === item.key
    const newItemOpen = newItemKey === item.key
    const editOpen = editKey === item.key
    const edited = Boolean(rowEdits[item.key])
    return (
      <Fragment key={item.key}>
        <tr className="hover:bg-gray-50 align-top">
          <td className="px-4 py-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.imageUrl}
              alt=""
              className="w-9 h-9 rounded object-cover ring-1 ring-gray-200"
            />
          </td>
          <td className="px-4 py-3">
            <span
              className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full mb-1 ${reviewStatusBadgeClass(item.status)}`}
            >
              {reviewStatusLabel(item.status)}
            </span>
            {edited && (
              <span className="ml-1 inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                Edited
              </span>
            )}
            <p className="font-medium text-gray-900">{item.row.description}</p>
          </td>
          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{item.row.qty}</td>
          <td className="px-4 py-3 text-gray-600">
            {item.suggestedProductName ?? <span className="text-gray-400">No suggestion</span>}
          </td>
          <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-1.5">
              {item.suggestedProductId && (
                <button
                  type="button"
                  onClick={() => handleAcceptSuggestion(item)}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-green-700 transition-colors"
                  title={`Accept: ${item.suggestedProductName}`}
                >
                  <Check size={14} /> Accept
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setNewItemKey(null)
                  setEditKey(null)
                  setOpenPickerKey(pickerOpen ? null : item.key)
                }}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  pickerOpen
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Link2 size={14} /> Link
              </button>
              <button
                type="button"
                onClick={() => (editOpen ? closeEdit() : openEdit(item))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  editOpen
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
                title="Correct what the photo transcription got wrong"
              >
                <Pencil size={14} /> Edit
              </button>
              {canCreateProduct && (
                <button
                  type="button"
                  onClick={() => (newItemOpen ? closeNewItem() : openNewItem(item))}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    newItemOpen
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                  title="Create a new product from this row"
                >
                  <PackagePlus size={14} /> New item
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSkipRow(item.key)}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 text-gray-500 px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50 hover:text-red-600 transition-colors"
                title="Skip — don't count this row"
              >
                <SkipForward size={14} /> Skip
              </button>
            </div>
          </td>
        </tr>
        {(pickerOpen || newItemOpen || editOpen) && (
          <tr className="bg-gray-50/60">
            <td />
            <td colSpan={4} className="px-4 pb-3">
              <div className={newItemOpen || editOpen ? 'max-w-2xl' : 'max-w-md'}>
                {editOpen
                  ? renderEditForm(item)
                  : newItemOpen
                    ? renderNewItemForm(item)
                    : renderProductPicker(item)}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  function renderReviewCard(item: UnmatchedReviewRow) {
    const pickerOpen = openPickerKey === item.key
    const newItemOpen = newItemKey === item.key
    const editOpen = editKey === item.key
    const edited = Boolean(rowEdits[item.key])
    return (
      <div key={item.key} className="p-4 flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt=""
          className="w-11 h-11 rounded object-cover ring-1 ring-gray-200 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${reviewStatusBadgeClass(item.status)}`}
            >
              {reviewStatusLabel(item.status)}
            </span>
            {edited && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                Edited
              </span>
            )}
            <span className="text-sm font-medium text-gray-900 truncate">{item.row.description}</span>
            <span className="text-sm tabular-nums text-gray-600">× {item.row.qty}</span>
          </div>
          {item.suggestedProductName && (
            <p className="text-xs text-gray-500 mb-2">Suggested: {item.suggestedProductName}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {item.suggestedProductId && (
              <button
                type="button"
                onClick={() => handleAcceptSuggestion(item)}
                className="inline-flex items-center gap-1 rounded-lg bg-green-600 text-white px-2.5 py-1.5 text-xs font-medium hover:bg-green-700"
              >
                <Check size={14} /> Accept
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setNewItemKey(null)
                setEditKey(null)
                setOpenPickerKey(pickerOpen ? null : item.key)
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                pickerOpen
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              <Link2 size={14} /> Link
            </button>
            <button
              type="button"
              onClick={() => (editOpen ? closeEdit() : openEdit(item))}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                editOpen
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-700'
              }`}
            >
              <Pencil size={14} /> Edit
            </button>
            {canCreateProduct && (
              <button
                type="button"
                onClick={() => (newItemOpen ? closeNewItem() : openNewItem(item))}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  newItemOpen
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-gray-300 text-gray-700'
                }`}
              >
                <PackagePlus size={14} /> New item
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSkipRow(item.key)}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 text-gray-500 px-2.5 py-1.5 text-xs font-medium hover:text-red-600"
            >
              <SkipForward size={14} /> Skip
            </button>
          </div>
          {editOpen ? (
            <div className="mt-2">{renderEditForm(item)}</div>
          ) : newItemOpen ? (
            <div className="mt-2">{renderNewItemForm(item)}</div>
          ) : (
            pickerOpen && <div className="mt-2">{renderProductPicker(item)}</div>
          )}
        </div>
      </div>
    )
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

        {pendingAdjustments.length > 0 && (
          <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            {pendingAdjustments.length} product{pendingAdjustments.length === 1 ? '' : 's'} with
            non-zero variance ready to submit.
          </div>
        )}

        <div className="flex gap-1 mb-5 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setActiveTab('count')}
            className={`-mb-px px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'count'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Count sheet
            {pendingAdjustments.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold px-1.5 min-w-5">
                {pendingAdjustments.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('photos')}
            className={`-mb-px px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'photos'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Photo review
            {unmatchedRows.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold px-1.5 min-w-5">
                {unmatchedRows.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === 'photos' && (
          <>
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
                        ({imageScopedRows.filter((r) => r.status === f).length})
                      </span>
                    )}
                    {f === 'all' && (
                      <span className="ml-1 opacity-80">({imageScopedRows.length})</span>
                    )}
                  </button>
                ))}
              </div>

              {reviewImageGroups.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-3">
                  <span className="text-[11px] text-gray-500 mr-0.5">Photo:</span>
                  <button
                    type="button"
                    onClick={() => setReviewImageFilter('all')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      activeImageFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    All photos ({statusScopedRows.length})
                  </button>
                  {reviewImageGroups.map((group, i) => {
                    const count = statusScopedRows.filter(
                      (r) => r.uploadId === group.uploadId,
                    ).length
                    return (
                    <button
                      key={group.uploadId}
                      type="button"
                      onClick={() => setReviewImageFilter(group.uploadId)}
                      title={`Photo ${i + 1} — ${count} row${count === 1 ? '' : 's'}`}
                      className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                        activeImageFilter === group.uploadId
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={group.imageUrl}
                        alt=""
                        className="w-6 h-6 rounded object-cover ring-1 ring-black/10"
                      />
                      #{i + 1} ({count})
                    </button>
                    )
                  })}
                </div>
              )}
            </div>
            {filteredReviewRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No rows in this filter</p>
            ) : (
              <>
                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-2.5 w-10"></th>
                        <th className="text-left px-4 py-2.5">Extracted row</th>
                        <th className="text-right px-4 py-2.5 w-16">Qty</th>
                        <th className="text-left px-4 py-2.5">Suggested match</th>
                        <th className="text-right px-4 py-2.5 w-56">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredReviewRows.map((item) => renderReviewRow(item))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: cards */}
                <div className="md:hidden divide-y divide-gray-100">
                  {filteredReviewRows.map((item) => renderReviewCard(item))}
                </div>
              </>
            )}
          </div>
        )}
          </>
        )}

        {activeTab === 'count' && (
          <>
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

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setShowCountedOnly(false)
                setPage(1)
              }}
              className={`px-3 py-1.5 transition-colors ${
                !showCountedOnly ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              All products
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCountedOnly(true)
                setPage(1)
              }}
              className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${
                showCountedOnly ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Counted
              <span
                className={`ml-1.5 inline-flex items-center justify-center rounded-full text-[11px] px-1.5 min-w-5 ${
                  showCountedOnly ? 'bg-white/25' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {countedProductIds.size}
              </span>
            </button>
          </div>
          <p className="text-xs text-gray-500">
            {visible.length.toLocaleString()} product{visible.length === 1 ? '' : 's'}
            {filterBrand !== 'all' ? ` · ${filterBrand}` : ''}
          </p>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-500">
            <Camera size={32} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">
              {showCountedOnly && countedProductIds.size === 0
                ? 'Nothing counted yet'
                : 'No products match your filters'}
            </p>
            {showCountedOnly && countedProductIds.size === 0 && (
              <p className="text-xs mt-1 max-w-xs text-center">
                Type a count against a product, or use Photo review — counted items will show here.
              </p>
            )}
            {(search || filterCategoryId !== 'all' || filterBrand !== 'all' || showCountedOnly) && (
              <button
                type="button"
                onClick={() => {
                  handleSearch('')
                  setFilterCategoryId('all')
                  setFilterBrand('all')
                  setShowCountedOnly(false)
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
          </>
        )}
      </div>
    </div>
  )
}
