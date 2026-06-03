import Link from 'next/link'
import { BarChart3, LayoutGrid, Package, ShoppingCart, Store } from 'lucide-react'

const nav = [
  { href: '/products', label: 'Products', icon: Store },
  { href: '/pos', label: 'POS', icon: ShoppingCart },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/categories', label: 'Categories', icon: LayoutGrid },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
]

export default function UILayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <nav className="w-56 border-r border-gray-200 bg-white flex flex-col py-5 px-3 gap-1 shrink-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest px-3 mb-2">
          POS System
        </p>
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>
      <main className="flex-1 overflow-hidden flex flex-col bg-white text-gray-900">{children}</main>
    </div>
  )
}
