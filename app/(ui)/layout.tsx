'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, LayoutDashboard, LayoutGrid, Settings, ShoppingCart, Store } from 'lucide-react'

const nav = [
  { href: '/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/products',  label: 'Products',   icon: Store },
  { href: '/pos',       label: 'POS',        icon: ShoppingCart },
  { href: '/categories',label: 'Brands',     icon: LayoutGrid },
  { href: '/reports',   label: 'Reports',    icon: BarChart3 },
  { href: '/settings',  label: 'Settings',   icon: Settings },
]

function navLinkClass(active: boolean, mobile = false) {
  if (mobile) {
    return active
      ? 'text-blue-600'
      : 'text-gray-500 hover:text-gray-800'
  }
  return active
    ? 'bg-blue-50 text-blue-700 font-medium'
    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
}

export default function UILayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Desktop sidebar — unchanged */}
      <nav className="hidden md:flex w-56 border-r border-gray-200 bg-white flex-col py-5 px-3 gap-1 shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-3 mb-2">
          POS System
        </p>
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
