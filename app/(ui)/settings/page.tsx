'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, FileText, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { fetchSettings, saveSettings, DEFAULT_SETTINGS, type PDFSettings } from '@/lib/settings'

const COLORS = [
  { label: 'Blue',   value: '#2563eb' },
  { label: 'Indigo', value: '#4f46e5' },
  { label: 'Green',  value: '#16a34a' },
  { label: 'Teal',   value: '#0d9488' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Rose',   value: '#e11d48' },
  { label: 'Gray',   value: '#374151' },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<PDFSettings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const logoInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchSettings().then((s) => {
      setSettings(s)
      setLoading(false)
    })
  }, [])

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
      toast.success('Settings saved', { description: 'PDF layout updated across all devices.' })
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
          { name: 'Copper Pipe 1/2"', sku: 'PL-001', category: 'Plumbing', sold: 18, stocked: 30, revenue: 54000, netStock: 12 },
          { name: 'Ball Valve 3/4"',  sku: 'PL-004', category: 'Plumbing', sold: 12, stocked: 20, revenue: 36000, netStock: 8  },
          { name: 'Drill Bit Set',    sku: 'DR-007', category: 'Tools',    sold: 8,  stocked: 5,  revenue: 40000, netStock: 3  },
          { name: 'Gate Valve 1"',    sku: 'PL-009', category: 'Plumbing', sold: 4,  stocked: 10, revenue: 18500, netStock: 4  },
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

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Customize how your PDF reports and quotations look.</p>
        </div>

        <div className="space-y-6">

          {/* Company Identity */}
          <section className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Company Identity</h2>
            </div>
            <div className="p-5 space-y-4">

              {/* Logo */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Logo</label>
                {settings.logoDataUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={settings.logoDataUrl} alt="Logo" className="h-12 w-12 object-contain border border-gray-200 rounded-lg p-1" />
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Logo uploaded</p>
                      <button onClick={removeLogo} className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1">
                        <X size={12} /> Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => logoInputRef.current?.click()}
                    className="flex items-center gap-2 border border-dashed border-gray-300 rounded-lg px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  >
                    <Upload size={16} />
                    Upload logo (PNG/JPG, max 500 KB)
                  </button>
                )}
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              </div>

              {/* Company Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  type="text"
                  value={settings.companyName}
                  onChange={(e) => set('companyName', e.target.value)}
                  placeholder="My Business"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tagline */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Tagline <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={settings.tagline}
                  onChange={(e) => set('tagline', e.target.value)}
                  placeholder="Quality products, trusted service"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </section>

          {/* PDF Style */}
          <section className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">PDF Style</h2>
            </div>
            <div className="p-5 space-y-4">

              {/* Primary colour */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">Primary Colour</label>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map(({ label, value }) => (
                    <button
                      key={value}
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
                  {/* Custom colour */}
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

              {/* Currency */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Currency Symbol</label>
                <input
                  type="text"
                  value={settings.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  placeholder="KES"
                  maxLength={6}
                  className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Footer text */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Footer Text</label>
                <input
                  type="text"
                  value={settings.footerText}
                  onChange={(e) => set('footerText', e.target.value)}
                  placeholder="Thank you for your business."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Appears at the bottom of every PDF page alongside the page number.</p>
              </div>
            </div>
          </section>

          {/* PDF Layout preview description */}
          <section className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-700">Report Layout</h2>
            </div>
            <div className="p-5">
              <div className="border border-gray-200 rounded-lg p-4 bg-white text-xs text-gray-600 space-y-2 font-mono">
                <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
                  <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center text-gray-400">img</div>
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
                  <p className="text-gray-400 mt-1">Full table with sold / stocked / revenue / net stock per product</p>
                </div>
                <p className="text-gray-400 border-t border-gray-100 pt-2">{settings.footerText || 'Footer text'} · Page 1 of N</p>
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex gap-3 pb-8">
            <button
              onClick={handlePreview}
              className="flex items-center gap-2 border border-gray-300 px-4 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <FileText size={15} />
              Preview PDF
            </button>
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {saved ? <Check size={15} /> : null}
              {saved ? 'Saved' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
