'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2, Check, FileText, GitBranch, Loader2, MapPin, Monitor, Percent, Plus, ScanBarcode, Star, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { fetchSettings, saveSettings, DEFAULT_SETTINGS, POS_LOOKUP_MODES, type PDFSettings, type PosLookupMode } from '@/lib/settings'
import { getMyBranchId, getMyOrgId, setMyBranchId } from '@/lib/branch'
import { getAll as getLocalBranches } from '@/lib/db/branches'
import type { Branch } from '@/lib/types'

const COLORS = [
  { label: 'Blue',   value: '#2563eb' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Green',  value: '#16a34a' },
  { label: 'Teal',   value: '#0d9488' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Rose',   value: '#e11d48' },
  { label: 'Gray',   value: '#374151' },
]

type SettingsTab = 'store' | 'pricing' | 'pos' | 'documents' | 'branches' | 'device'

const TABS: { id: SettingsTab; label: string; description: string; icon: typeof Building2 }[] = [
  { id: 'store',     label: 'Store',     description: 'Name, logo & branding',        icon: Building2 },
  { id: 'pricing',   label: 'Pricing',   description: 'POS discount rules',           icon: Percent },
  { id: 'pos',       label: 'POS',       description: 'Checkout & product lookup',    icon: ScanBarcode },
  { id: 'documents', label: 'Documents', description: 'PDF reports & quotations',     icon: FileText },
  { id: 'branches',  label: 'Branches',  description: 'Create & manage branches',     icon: GitBranch },
  { id: 'device',    label: 'Device',    description: "This device's branch assignment", icon: Monitor },
]

type BranchForm = { name: string; code: string; address: string }
const EMPTY_BRANCH_FORM: BranchForm = { name: '', code: '', address: '' }

export default function SettingsPage() {
  const [settings, setSettings] = useState<PDFSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<SettingsTab>('store')
  const logoInputRef = useRef<HTMLInputElement>(null)

  // Branches tab state
  const [branches, setBranches]           = useState<Branch[]>([])
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchForm, setBranchForm]       = useState<BranchForm>(EMPTY_BRANCH_FORM)
  const [branchSaving, setBranchSaving]   = useState(false)

  // Device tab state
  const [deviceBranchId, setDeviceBranchId] = useState<string | null>(null)
  const [deviceChanging, setDeviceChanging]  = useState(false)

  useEffect(() => {
    fetchSettings().then((s) => { setSettings(s); setLoading(false) })
    setDeviceBranchId(getMyBranchId())
  }, [])

  useEffect(() => {
    if (activeTab === 'branches' && branches.length === 0) loadBranches()
    if (activeTab === 'device'   && branches.length === 0) loadBranches()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  async function loadBranches() {
    setBranchesLoading(true)
    try {
      const local = await getLocalBranches()
      if (local.length > 0) { setBranches(local); setBranchesLoading(false); return }
      const orgId = getMyOrgId()
      const url   = orgId ? `/api/branches?organizationId=${orgId}` : '/api/branches'
      const res   = await fetch(url, { cache: 'no-store' })
      if (res.ok) setBranches((await res.json()).data ?? [])
    } finally {
      setBranchesLoading(false)
    }
  }

  async function handleCreateBranch() {
    if (!branchForm.name.trim() || !branchForm.code.trim()) {
      toast.error('Name and code are required')
      return
    }
    const orgId = getMyOrgId()
    if (!orgId) { toast.error('No organization found. Sync catalog first.'); return }
    setBranchSaving(true)
    try {
      const res = await fetch('/api/branches', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ organizationId: orgId, ...branchForm }),
      })
      const { data, error } = await res.json()
      if (!res.ok) { toast.error(error ?? 'Failed to create branch'); return }
      setBranches((prev) => [...prev, data])
      setBranchForm(EMPTY_BRANCH_FORM)
      toast.success(`Branch "${data.name}" created`)
    } finally {
      setBranchSaving(false)
    }
  }

  async function handleSetPrimary(branch: Branch) {
    try {
      const res = await fetch(`/api/branches/${branch.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ isPrimary: true }),
      })
      if (!res.ok) { toast.error('Failed to update primary branch'); return }
      setBranches((prev) => prev.map((b) => ({ ...b, isPrimary: b.id === branch.id })))
      toast.success(`"${branch.name}" is now the primary branch`)
    } catch {
      toast.error('Failed to update primary branch')
    }
  }

  function handleDeviceBranchChange(newBranchId: string) {
    setDeviceChanging(true)
    setMyBranchId(newBranchId)
    setDeviceBranchId(newBranchId)
    const b = branches.find((b) => b.id === newBranchId)
    toast.success(`Device reassigned to "${b?.name ?? newBranchId}"`)
    setDeviceChanging(false)
  }

  function set<K extends keyof PDFSettings>(key: K, value: PDFSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 500_000) {
      toast.error('Logo too large', { description: 'Please use an image under 500 KB.' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('logoDataUrl', reader.result as string)
    reader.readAsDataURL(file)
  }

  function removeLogo() {
    set('logoDataUrl', '')
    if (logoInputRef.current) logoInputRef.current.value = ''
  }

  async function handleSave() {
    try {
      await saveSettings(settings)
      setSaved(true)
      toast.success('Settings saved', { description: 'Changes apply across all devices.' })
    } catch {
      toast.error('Failed to save settings', { description: 'Check your connection and try again.' })
    }
  }

  async function handlePreview() {
    try {
      const { generateCOBReportPDF } = await import('@/lib/pdf')
      const doc = generateCOBReportPDF({
        dateLabel: new Date().toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }),
        revenue: 148500,
        unitsSold: 42,
        lowStockCount: 2,
        grossMargin: 34.2,
        rows: [
          { name: 'Copper Pipe 1/2"', sku: 'PL-001', category: 'Plumbing', sold: 18, stocked: 30, listRevenue: 54000, revenue: 54000, netStock: 12 },
          { name: 'Ball Valve 3/4"',  sku: 'PL-004', category: 'Plumbing', sold: 12, stocked: 20, listRevenue: 36000, revenue: 34000, netStock: 8  },
          { name: 'Drill Bit Set',    sku: 'DR-007', category: 'Tools',    sold: 8,  stocked: 5,  listRevenue: 40000, revenue: 40000, netStock: 3  },
          { name: 'Gate Valve 1"',    sku: 'PL-009', category: 'Plumbing', sold: 4,  stocked: 10, listRevenue: 18500, revenue: 18500, netStock: 4  },
        ],
        lowStockItems: [
          { name: 'Drill Bit Set', sku: 'DR-007', stock: 3 },
          { name: 'Gate Valve 1"', sku: 'PL-009', stock: 4 },
        ],
      })
      doc.save('preview-report.pdf')
      toast.success('Preview downloaded')
    } catch {
      toast.error('Preview failed')
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        Loading settings…
      </div>
    )
  }

  const activeMeta = TABS.find((t) => t.id === activeTab)!

  return (
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden bg-gray-50/50">
      {/* Sidebar nav — desktop */}
      <aside className="hidden lg:flex lg:w-60 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="px-5 py-6 border-b border-gray-100">
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-xs text-gray-500 mt-1">Manage your store</p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {TABS.map(({ id, label, description, icon: Icon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Icon size={16} className={active ? 'text-blue-600' : 'text-gray-400'} />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <p className={`text-xs mt-0.5 pl-[26px] ${active ? 'text-blue-600/70' : 'text-gray-400'}`}>
                  {description}
                </p>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile header + tab bar */}
        <div className="shrink-0 border-b border-gray-200 bg-white lg:bg-transparent">
          <div className="px-5 pt-5 pb-3 lg:px-8 lg:pt-8">
            <div className="lg:hidden mb-4">
              <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
              <p className="text-xs text-gray-500 mt-0.5">Manage your store</p>
            </div>
            <nav className="flex gap-1 overflow-x-auto pb-1 lg:hidden scrollbar-none">
              {TABS.map(({ id, label, icon: Icon }) => {
                const active = activeTab === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 shrink-0 px-3.5 py-2 rounded-full text-sm font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                )
              })}
            </nav>
          </div>
        </div>

        {/* Panel header + actions */}
        <div className="shrink-0 flex items-center justify-between gap-4 px-5 py-4 lg:px-8 border-b border-gray-200 bg-white">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{activeMeta.label}</h2>
            <p className="text-xs text-gray-500 mt-0.5 hidden sm:block">{activeMeta.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'documents' && (
              <button
                type="button"
                onClick={handlePreview}
                className="hidden sm:flex items-center gap-1.5 border border-gray-300 px-3 py-2 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <FileText size={14} />
                Preview PDF
              </button>
            )}
            {activeTab !== 'branches' && activeTab !== 'device' && (
              <button
                type="button"
                onClick={handleSave}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                  saved
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {saved ? <Check size={14} /> : null}
                {saved ? 'Saved' : 'Save'}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable panel body */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-5 py-6 lg:px-8 lg:py-8">
            {activeTab === 'store' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Logo</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Shown on PDF reports and quotations.</p>
                  </div>
                  {settings.logoDataUrl ? (
                    <div className="flex items-center gap-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={settings.logoDataUrl} alt="Logo" className="h-16 w-16 object-contain border border-gray-200 rounded-xl p-1.5 bg-gray-50" />
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500">Logo uploaded</p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => logoInputRef.current?.click()}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Replace
                          </button>
                          <button type="button" onClick={removeLogo} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                            <X size={12} /> Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      className="w-full flex flex-col items-center gap-2 border border-dashed border-gray-300 rounded-xl px-4 py-8 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
                    >
                      <Upload size={20} className="text-gray-400" />
                      Upload logo (PNG/JPG, max 500 KB)
                    </button>
                  )}
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </section>

                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Business details</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Used across the app and on exported documents.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">Company name</label>
                    <input
                      type="text"
                      value={settings.companyName}
                      onChange={(e) => set('companyName', e.target.value)}
                      placeholder="My Business"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">
                      Tagline <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={settings.tagline}
                      onChange={(e) => set('tagline', e.target.value)}
                      placeholder="Quality products, trusted service"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">Currency symbol</label>
                    <input
                      type="text"
                      value={settings.currency}
                      onChange={(e) => set('currency', e.target.value)}
                      placeholder="KES"
                      maxLength={6}
                      className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'pricing' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Discount floor rule</h3>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      Controls the lowest price cashiers can sell at in POS. Discount = selling price − negotiated price.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">Minimum markup on cost</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                        value={settings.minMarkupPercent}
                        onChange={(e) => set('minMarkupPercent', Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>
                  </div>
                </section>

                <section className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-5 space-y-3">
                  <h3 className="text-xs font-semibold text-amber-900 uppercase tracking-wide">How it works</h3>
                  <ol className="text-xs text-amber-900/80 space-y-2 list-decimal list-inside leading-relaxed">
                    <li>Floor = cost × (markup% ÷ 100). At 150%, cost KES 100 → floor KES 150.</li>
                    <li>Floor is capped at selling price — no discount if markup exceeds list price.</li>
                    <li>Per-product <strong className="font-medium">Lowest price</strong> can raise the floor, never lower it.</li>
                  </ol>
                  <div className="rounded-lg bg-white border border-amber-200/60 p-3 text-xs font-mono text-gray-700 space-y-1">
                    <p>cost = 100 · sell = 200 · markup = {settings.minMarkupPercent}%</p>
                    <p className="text-amber-700 font-semibold">
                      floor = min(200, 100 × {settings.minMarkupPercent / 100}) = {Math.min(200, 100 * settings.minMarkupPercent / 100).toLocaleString()}
                    </p>
                    <p className="text-gray-500">max discount per unit = {Math.max(0, 200 - Math.min(200, 100 * settings.minMarkupPercent / 100)).toLocaleString()}</p>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'pos' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Product lookup at checkout</h3>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      Choose how cashiers find products on the POS screen. Hardware stores typically use catalog search; retail stores use barcode scanning.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {POS_LOOKUP_MODES.map(({ value, label, description }) => {
                      const selected = settings.posLookupMode === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => set('posLookupMode', value as PosLookupMode)}
                          className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                            selected
                              ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-sm font-medium ${selected ? 'text-blue-800' : 'text-gray-800'}`}>
                              {label}
                            </span>
                            {selected && <Check size={16} className="text-blue-600 shrink-0" />}
                          </div>
                          <p className={`text-xs mt-1 leading-relaxed ${selected ? 'text-blue-700/80' : 'text-gray-500'}`}>
                            {description}
                          </p>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {settings.posLookupMode !== 'catalog' && (
                  <section className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-5 space-y-2">
                    <h3 className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Barcode mode enabled</h3>
                    <ul className="text-xs text-blue-900/80 space-y-1.5 list-disc list-inside leading-relaxed">
                      <li>Add a <strong className="font-medium">Barcode</strong> field when creating or editing products.</li>
                      <li>USB scanners type into the POS search box — exact match adds the item to the cart.</li>
                      <li>CSV imports can include a <strong className="font-medium">barcode</strong>, <strong className="font-medium">ean</strong>, or <strong className="font-medium">upc</strong> column.</li>
                    </ul>
                  </section>
                )}
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">PDF appearance</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Colours and footer for reports and quotations.</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">Primary colour</label>
                    <div className="flex flex-wrap gap-2">
                      {COLORS.map(({ label, value }) => (
                        <button
                          key={value}
                          type="button"
                          title={label}
                          onClick={() => set('primaryColor', value)}
                          className="relative w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                          style={{
                            backgroundColor: value,
                            borderColor: settings.primaryColor === value ? value : 'transparent',
                            outline: settings.primaryColor === value ? `2px solid ${value}` : undefined,
                            outlineOffset: settings.primaryColor === value ? '2px' : undefined,
                          }}
                        >
                          {settings.primaryColor === value && (
                            <Check size={14} className="absolute inset-0 m-auto text-white" />
                          )}
                        </button>
                      ))}
                      <label className="relative w-8 h-8 rounded-full border border-gray-300 overflow-hidden cursor-pointer hover:scale-110 transition-transform" title="Custom colour">
                        <input
                          type="color"
                          value={settings.primaryColor}
                          onChange={(e) => set('primaryColor', e.target.value)}
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                        <span className="flex items-center justify-center h-full text-gray-400 text-xs">+</span>
                      </label>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-700">Footer text</label>
                    <input
                      type="text"
                      value={settings.footerText}
                      onChange={(e) => set('footerText', e.target.value)}
                      placeholder="Thank you for your business."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-400">Appears at the bottom of every PDF page with the page number.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePreview}
                    className="sm:hidden w-full flex items-center justify-center gap-2 border border-gray-300 px-4 py-2.5 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <FileText size={15} />
                    Preview PDF
                  </button>
                </section>

                <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                    <h3 className="text-sm font-semibold text-gray-800">Live preview</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Report header and KPI block</p>
                  </div>
                  <div className="p-5">
                    <div className="border border-gray-200 rounded-lg p-4 bg-white text-xs text-gray-600 space-y-2 font-mono shadow-sm">
                      <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
                        {settings.logoDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={settings.logoDataUrl} alt="" className="w-8 h-8 object-contain rounded" />
                        ) : (
                          <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-gray-400">img</div>
                        )}
                        <div>
                          <p className="font-semibold text-gray-800">{settings.companyName || 'Company Name'}</p>
                          {settings.tagline && <p className="text-gray-400">{settings.tagline}</p>}
                        </div>
                      </div>
                      <div className="h-0.5 rounded" style={{ backgroundColor: settings.primaryColor }} />
                      <div className="rounded p-2" style={{ backgroundColor: '#f3f4f6' }}>
                        <p className="font-bold" style={{ color: settings.primaryColor }}>Key Performance Indicators</p>
                        <div className="grid grid-cols-4 gap-2 mt-1">
                          {['Revenue', 'Units Sold', 'Low Stock', 'Margin'].map((k) => (
                            <div key={k}>
                              <p className="text-gray-400">{k}</p>
                              <p className="font-bold text-gray-800">—</p>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded p-2" style={{ backgroundColor: '#f3f4f6' }}>
                        <p className="font-bold" style={{ color: settings.primaryColor }}>Product Breakdown</p>
                        <p className="text-gray-400 mt-1">Sold / stocked / revenue / net stock per product</p>
                      </div>
                      <p className="text-gray-400 border-t border-gray-100 pt-2">
                        {settings.footerText || 'Footer text'} · Page 1 of N
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            )}
            {activeTab === 'branches' && (
              <div className="space-y-6">
                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Your branches</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Each branch has its own stock and sales records.</p>
                  </div>
                  {branchesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                  ) : branches.length === 0 ? (
                    <p className="text-sm text-gray-400">No branches yet. Create one below.</p>
                  ) : (
                    <div className="space-y-2">
                      {branches.map((branch) => (
                        <div key={branch.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3 bg-gray-50">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-medium text-gray-900">{branch.name}</span>
                              <span className="text-[10px] font-mono bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                                {branch.code}
                              </span>
                              {branch.isPrimary && (
                                <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                                  <Star size={10} className="fill-amber-400 text-amber-400" />
                                  Primary
                                </span>
                              )}
                            </div>
                            {branch.address && (
                              <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                                <MapPin size={10} />
                                {branch.address}
                              </p>
                            )}
                          </div>
                          {!branch.isPrimary && (
                            <button
                              type="button"
                              onClick={() => handleSetPrimary(branch)}
                              className="shrink-0 text-xs text-blue-600 hover:underline"
                            >
                              Set primary
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">Add a branch</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Code is short and unique per organisation (e.g. CBD, WL, MSA).</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-700">Name</label>
                      <input
                        type="text"
                        value={branchForm.name}
                        onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Westlands Branch"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-gray-700">Code</label>
                      <input
                        type="text"
                        value={branchForm.code}
                        onChange={(e) => setBranchForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                        placeholder="WL"
                        maxLength={8}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-gray-700">
                      Address <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={branchForm.address}
                      onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="Sarit Centre, Westlands, Nairobi"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateBranch}
                    disabled={branchSaving}
                    className="flex items-center gap-1.5 bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
                  >
                    {branchSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {branchSaving ? 'Creating…' : 'Create branch'}
                  </button>
                </section>
              </div>
            )}

            {activeTab === 'device' && (
              <div className="space-y-6">
                {!deviceBranchId && (
                  <section className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <p className="text-sm font-medium text-amber-800">No branch assigned</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Select a branch below. POS and stock will not work correctly until this is done.
                    </p>
                  </section>
                )}

                <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800">This device's branch</h3>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                      Every sale, restock, and transfer on this device is recorded against this branch.
                      Changing it takes effect immediately.
                    </p>
                  </div>

                  {branchesLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Loader2 size={14} className="animate-spin" /> Loading branches…
                    </div>
                  ) : branches.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      No branches found. Go to the Branches tab to create one first.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {branches.map((branch) => {
                        const selected = branch.id === deviceBranchId
                        return (
                          <button
                            key={branch.id}
                            type="button"
                            disabled={deviceChanging}
                            onClick={() => handleDeviceBranchChange(branch.id)}
                            className={`w-full text-left rounded-xl border px-4 py-3 transition-colors flex items-center justify-between gap-2 ${
                              selected
                                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-sm font-medium ${selected ? 'text-blue-800' : 'text-gray-800'}`}>
                                  {branch.name}
                                </span>
                                <span className="text-[10px] font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                  {branch.code}
                                </span>
                                {branch.isPrimary && (
                                  <span className="flex items-center gap-0.5 text-[10px] text-amber-600 font-medium">
                                    <Star size={10} className="fill-amber-400 text-amber-400" />
                                    Primary
                                  </span>
                                )}
                              </div>
                              {branch.address && (
                                <p className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                                  <MapPin size={10} />
                                  {branch.address}
                                </p>
                              )}
                            </div>
                            {selected && <Check size={16} className="text-blue-600 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>

                <section className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-gray-500">
                    <span className="font-medium text-gray-700">Note:</span> Each device (phone, tablet, PC) must be
                    assigned to one branch. Reassigning mid-day is not recommended as it will split the day's
                    transactions across two branches in reports.
                  </p>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
