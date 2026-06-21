'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeftRight, BarChart3, LayoutDashboard, LayoutGrid, Settings, ShoppingCart, Store } from 'lucide-react'
import { BranchSetup } from '@/components/BranchSetup'
import { getMyBranchId } from '@/lib/branch'
import { getAll as getBranches } from '@/lib/db/branches'
import type { Branch } from '@/lib/types'

const nav = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/products',   label: 'Products',   icon: Store },
  { href: '/pos',        label: 'POS',        icon: ShoppingCart },
  { href: '/transfers',  label: 'Transfers',  icon: ArrowLeftRight },
  { href: '/categories', label: 'Brands',     icon: LayoutGrid },
  { href: '/reports',    label: 'Reports',    icon: BarChart3 },
  { href: '/settings',   label: 'Settings',   icon: Settings },
]

function navLinkClass(active: boolean, mobile = false) {
  if (mobile) {
    return active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-800'
  }
  return active
    ? 'bg-blue-50 text-blue-700 font-medium'
    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
}

export default function UILayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mounted, setMounted]             = useState(false)
  const [branchId, setBranchId]           = useState<string | null>(null)
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null)

  useEffect(() => {
    const id = getMyBranchId()
    setBranchId(id)
    setMounted(true)
    if (id) {
      getBranches().then((all) => setCurrentBranch(all.find((b) => b.id === id) ?? null))
    }
  }, [])

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  if (!mounted) return null

  if (!branchId) {
    return (
      <BranchSetup
        onComplete={() => {
          const id = getMyBranchId()
          setBranchId(id)
          if (id) {
            getBranches().then((all) => setCurrentBranch(all.find((b) => b.id === id) ?? null))
          }
        }}
      />
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-56 border-r border-gray-200 bg-white flex-col py-5 px-3 gap-1 shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-3 mb-1">
          POS System
        </p>
        {currentBranch && (
          <div className="px-3 mb-2">
            <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2 py-0.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
              {currentBranch.name}
            </span>
          </div>
        )}
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${navLinkClass(isActive(href))}`}
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      <main className="flex-1 overflow-hidden flex flex-col bg-white text-gray-900 min-w-0">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm safe-area-pb">
        <div className="flex items-stretch justify-around px-1 pt-1 pb-2">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center gap-0.5 min-w-0 flex-1 py-1.5 px-1 text-[10px] font-medium transition-colors ${navLinkClass(active, true)}`}
              >
                <Icon size={20} strokeWidth={active ? 2.25 : 2} />
                <span className="truncate max-w-full">{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
