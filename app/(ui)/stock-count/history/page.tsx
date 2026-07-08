'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { fetchMe, hasPermission, type AuthUser } from '@/lib/auth'
import { getMyBranchId } from '@/lib/branch'
import { getAll as getBranches } from '@/lib/db/branches'
import type { Branch } from '@/lib/types'
import type { StockCountReportRow } from '@/lib/stock-count/types'

type DaySummary = {
  date: string
  adjustments: number
  productCount: number
  netVariance: number
  firstAt: string
  lastAt: string
}

function formatDelta(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`
}

function formatDayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-KE', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
}

export default function StockCountHistoryPage() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null)

  const [days, setDays] = useState<DaySummary[]>([])
  const [loadingDays, setLoadingDays] = useState(false)

  const [openDate, setOpenDate] = useState<string | null>(null)
  const [rows, setRows] = useState<StockCountReportRow[]>([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [exporting, setExporting] = useState(false)

  const isOwner = authUser?.role === 'OWNER'
  const canView = authUser ? isOwner || hasPermission(authUser, 'stock.count.adjust') : false
  const branchName = useMemo(
    () => branches.find((b) => b.id === selectedBranchId)?.name ?? 'This branch',
    [branches, selectedBranchId],
  )

  // Owners may pick any branch; everyone else is locked to their own.
  const selectableBranches = useMemo(
    () => (isOwner ? branches : branches.filter((b) => b.id === selectedBranchId)),
    [isOwner, branches, selectedBranchId],
  )

  useEffect(() => {
    let alive = true
    void (async () => {
      const [me, all] = await Promise.all([fetchMe(), getBranches()])
      if (!alive) return
      setAuthUser(me)
      setBranches(all)
      setSelectedBranchId(getMyBranchId() ?? me?.branchId ?? all[0]?.id ?? null)
      setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const loadDays = useCallback(async (branchId: string) => {
    setLoadingDays(true)
    try {
      const res = await fetch(`/api/stock-count/history?branchId=${encodeURIComponent(branchId)}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load history')
      setDays(json.data.days ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load history')
      setDays([])
    } finally {
      setLoadingDays(false)
    }
  }, [])

  useEffect(() => {
    if (!ready || !selectedBranchId || !canView) return
    void loadDays(selectedBranchId)
  }, [ready, selectedBranchId, canView, loadDays])

  async function openDay(date: string) {
    if (!selectedBranchId) return
    setOpenDate(date)
    setLoadingRows(true)
    setRows([])
    try {
      const res = await fetch(
        `/api/stock-count/history?branchId=${encodeURIComponent(selectedBranchId)}&date=${date}`,
        { cache: 'no-store' },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load report')
      setRows(json.data.rows ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load report')
      setOpenDate(null)
    } finally {
      setLoadingRows(false)
    }
  }

  function exportCsv() {
    if (!openDate) return
    const header = 'Product,SKU,Expected,Counted,Variance,Status'
    const lines = rows.map((r) => {
      const status = r.delta === 0 ? 'Match' : r.delta < 0 ? 'Short' : 'Over'
      return `"${r.name}","${r.sku}",${r.expected},${r.counted},${r.delta},${status}`
    })
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `stock-count-${branchName}-${openDate}.csv`.replace(/\s+/g, '-')
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPdf() {
    if (!openDate) return
    setExporting(true)
    try {
      const { generateStockCountReportPDF } = await import('@/lib/pdf')
      const doc = generateStockCountReportPDF({
        branchName,
        submittedAt: formatDayLabel(openDate),
        rows,
      })
      doc.save(`stock-count-${branchName}-${openDate}.pdf`.replace(/\s+/g, '-'))
      toast.success('Report downloaded as PDF')
    } catch {
      toast.error('Failed to generate PDF')
    } finally {
      setExporting(false)
    }
  }

  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-gray-400" size={24} />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
        <AlertTriangle className="text-amber-500" size={28} />
        <p className="text-gray-700 font-medium">You don’t have access to stock count history.</p>
        <Link href="/stock-count" className="text-blue-600 text-sm hover:underline">
          Back to Stock Count
        </Link>
      </div>
    )
  }

  const openDay_ = openDate
    ? {
        matched: rows.filter((r) => r.delta === 0).length,
        short: rows.filter((r) => r.delta < 0).length,
        over: rows.filter((r) => r.delta > 0).length,
        net: Math.round(rows.reduce((s, r) => s + r.delta, 0) * 100) / 100,
        sorted: [...rows].sort((a, b) => a.delta - b.delta),
      }
    : null

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 md:px-4 md:py-6 min-w-0 pb-28 md:pb-6">
      <div className="w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-5 md:mb-6">
          <div>
            <Link
              href="/stock-count"
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1"
            >
              <ArrowLeft size={13} /> Stock Count
            </Link>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2">
              <CalendarDays size={22} className="text-blue-600 shrink-0" />
              Count History
            </h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              Past stock counts, grouped by day. Open one to view and re-export its report.
            </p>
          </div>

          {isOwner && branches.length > 1 && (
            <select
              value={selectedBranchId ?? ''}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full md:w-auto"
            >
              {selectableBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {loadingDays ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="animate-spin text-gray-400" size={22} />
          </div>
        ) : days.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 py-16 text-center">
            <FileText className="mx-auto text-gray-300 mb-2" size={28} />
            <p className="text-gray-600 font-medium">No stock counts recorded for {branchName}.</p>
            <p className="text-gray-400 text-sm mt-0.5">
              Counts appear here once they’re submitted from the Stock Count screen.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {days.map((d) => (
              <button
                key={d.date}
                type="button"
                onClick={() => void openDay(d.date)}
                className="group flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-left hover:border-blue-300 hover:bg-blue-50/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{formatDayLabel(d.date)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {d.productCount} product{d.productCount === 1 ? '' : 's'} · {d.adjustments} adjustment
                    {d.adjustments === 1 ? '' : 's'} · {formatTime(d.firstAt)}–{formatTime(d.lastAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Net variance</p>
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        d.netVariance > 0
                          ? 'text-green-600'
                          : d.netVariance < 0
                            ? 'text-red-600'
                            : 'text-gray-500'
                      }`}
                    >
                      {formatDelta(d.netVariance)}
                    </p>
                  </div>
                  <ChevronRight className="text-gray-300 group-hover:text-blue-400" size={18} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {openDate && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpenDate(null)
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Stock Count Report</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {branchName} · {formatDayLabel(openDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenDate(null)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {loadingRows || !openDay_ ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="animate-spin text-gray-400" size={22} />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Items counted</p>
                      <p className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{rows.length}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Matched</p>
                      <p className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{openDay_.matched}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Short</p>
                      <p className="text-2xl font-semibold text-red-600 tabular-nums mt-1">{openDay_.short}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-wide text-gray-500">Over</p>
                      <p className="text-2xl font-semibold text-green-600 tabular-nums mt-1">{openDay_.over}</p>
                    </div>
                  </div>

                  {openDay_.short > 0 && (
                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5 text-sm text-amber-800">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      <p>
                        {openDay_.short} item{openDay_.short === 1 ? '' : 's'} ended below their prior stock — usually a
                        sign the same product was counted and submitted more than once. Worth a quick recount.
                      </p>
                    </div>
                  )}

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                          <tr>
                            <th className="text-left px-4 py-2.5">Product</th>
                            <th className="text-right px-4 py-2.5">Expected</th>
                            <th className="text-right px-4 py-2.5">Counted</th>
                            <th className="text-right px-4 py-2.5">Variance</th>
                            <th className="text-left px-4 py-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {openDay_.sorted.map((r) => (
                            <tr key={r.productId} className="hover:bg-gray-50">
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-gray-900">{r.name}</p>
                                <p className="text-xs text-gray-500">{r.sku}</p>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.expected}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{r.counted}</td>
                              <td
                                className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                                  r.delta > 0 ? 'text-green-600' : r.delta < 0 ? 'text-red-600' : 'text-gray-500'
                                }`}
                              >
                                {formatDelta(r.delta)}
                              </td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={`inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${
                                    r.delta === 0
                                      ? 'bg-gray-100 text-gray-600'
                                      : r.delta < 0
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-green-100 text-green-800'
                                  }`}
                                >
                                  {r.delta === 0 ? 'Match' : r.delta < 0 ? 'Short' : 'Over'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 mt-3">
                    Net variance:{' '}
                    <span
                      className={`font-medium tabular-nums ${
                        openDay_.net > 0 ? 'text-green-600' : openDay_.net < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}
                    >
                      {formatDelta(openDay_.net)}
                    </span>{' '}
                    units across {rows.length} counted item{rows.length === 1 ? '' : 's'}.
                  </p>
                </>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={exportCsv}
                disabled={loadingRows || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 text-gray-700 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <Download size={15} /> CSV
              </button>
              <button
                type="button"
                onClick={() => void exportPdf()}
                disabled={loadingRows || exporting || rows.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
