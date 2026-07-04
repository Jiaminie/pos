'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingCart,
  Store,
  WifiOff,
} from 'lucide-react'
import { BranchSetup } from '@/components/BranchSetup'
import { PinLogin } from '@/components/PinLogin'
import { getMyBranchId } from '@/lib/branch'
import { getDeviceUiMode, type DeviceUiMode } from '@/lib/device-ui'
import { getAll as getBranches } from '@/lib/db/branches'
import { replaceCatalogFromServer } from '@/lib/db/seed'
import { cacheAuthUser, clearCachedAuthUser, fetchMe, getCachedAuthUser, logout, type AuthUser, canViewReports, hasPermission } from '@/lib/auth'
import type { Branch } from '@/lib/types'
import { toast } from 'sonner'

const SIDEBAR_COLLAPSED_KEY = 'pos_sidebar_collapsed'
// How often to re-sync permissions from the server as a fallback when the tab
// stays focused. Focus/visibility/online events cover most cases; this catches
// the rest without hammering the endpoint.
const AUTH_REVALIDATE_MS = 60_000

/** Did the identity, branch, or effective permission set actually change? */
function authChanged(a: AuthUser | null, b: AuthUser | null): boolean {
  if (!a || !b) return a !== b
  if (a.userId !== b.userId || a.role !== b.role || a.branchId !== b.branchId) return true
  const pa = [...(a.permissions ?? [])].sort().join(',')
  const pb = [...(b.permissions ?? [])].sort().join(',')
  return pa !== pb
}

const nav = [
  { href: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/products',   label: 'Products',   icon: Store },
  { href: '/pos',        label: 'POS',        icon: ShoppingCart },
  { href: '/transfers',  label: 'Transfers',  icon: ArrowLeftRight },
  { href: '/stock-count', label: 'Stock Count', icon: ClipboardList },
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
  const router = useRouter()
  const [mounted, setMounted]             = useState(false)
  const [branchId, setBranchId]           = useState<string | null>(null)
  const [branches, setBranches]           = useState<Branch[]>([])
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null)
  const [authUser, setAuthUser]           = useState<AuthUser | null>(null)
  const [authChecked, setAuthChecked]     = useState(false)
  const [syncing, setSyncing]             = useState(false)
  const [switching, setSwitching]         = useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [deviceUiMode, setDeviceUiMode] = useState<DeviceUiMode>('desktop')

  // Mirror authUser into a ref so the revalidation callback can compare against
  // the latest value without being re-created (and re-binding listeners) on
  // every change.
  const authUserRef = useRef<AuthUser | null>(null)
  useEffect(() => {
    authUserRef.current = authUser
  }, [authUser])

  // Pull the current session + effective permissions from the server and apply
  // them only when something meaningful changed. Keeps this device's UI in sync
  // when an owner edits role permissions elsewhere — no reload or re-login.
  //
  // Unlike fetchMe() (used at mount/login), a 401 here is the only signal that
  // actually means "logged out" — any other failure (500, rate limit, a flaky
  // request) must leave the existing session alone, or a transient server hiccup
  // would silently strand a cashier back on the PIN screen mid-shift.
  const revalidateAuth = useCallback(async () => {
    let res: Response
    try {
      res = await fetch('/api/auth/me', { cache: 'no-store' })
    } catch {
      return
    }
    if (res.status === 401) {
      const prev = authUserRef.current
      if (prev) {
        clearCachedAuthUser()
        setAuthUser(null)
      }
      return
    }
    if (!res.ok) return
    const { data: fresh } = await res.json().catch(() => ({ data: null }))
    if (!fresh) return
    const prev = authUserRef.current
    if (!authChanged(prev, fresh)) return
    cacheAuthUser(fresh)
    if (prev) toast.info('Your permissions were updated')
    setAuthUser(fresh)
  }, [])

  // Re-sync on the natural "returning to the app" signals plus a slow interval.
  useEffect(() => {
    if (!branchId) return
    const revalidateIfVisible = () => {
      if (!document.hidden) void revalidateAuth()
    }
    window.addEventListener('focus', revalidateIfVisible)
    window.addEventListener('online', revalidateIfVisible)
    document.addEventListener('visibilitychange', revalidateIfVisible)
    const interval = setInterval(revalidateIfVisible, AUTH_REVALIDATE_MS)
    return () => {
      window.removeEventListener('focus', revalidateIfVisible)
      window.removeEventListener('online', revalidateIfVisible)
      document.removeEventListener('visibilitychange', revalidateIfVisible)
      clearInterval(interval)
    }
  }, [branchId, revalidateAuth])

  useEffect(() => {
    const id = getMyBranchId()
    const mode = getDeviceUiMode()
    setBranchId(id)
    setDeviceUiMode(mode)
    document.documentElement.setAttribute('data-ui-mode', mode)
    setMounted(true)
    setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true')
    if (id) {
      getBranches().then((all) => {
        setBranches(all)
        setCurrentBranch(all.find((b) => b.id === id) ?? null)
      })
      fetchMe().then((u) => {
        setAuthUser(u)
        setAuthChecked(true)
      })
    } else {
      setAuthChecked(true)
    }
  }, [])

  async function afterLogin() {
    setSyncing(true)
    try {
      // Establish the session in the UI first. A catalog-sync hiccup must never
      // leave authUser null — that strands the user back on the PIN screen and
      // forces a manual reload (the mount path recovers from the cookie).
      const u = (await fetchMe()) ?? getCachedAuthUser()
      setAuthUser(u)
      const all = await getBranches()
      setBranches(all)
      const id = getMyBranchId()
      if (id) setCurrentBranch(all.find((b) => b.id === id) ?? null)
      try {
        await replaceCatalogFromServer()
      } catch {
        toast.error('Catalog sync failed — working from cached data')
      }
      router.replace('/pos')
    } finally {
      setSyncing(false)
    }
  }

  async function handleOwnerBranchSwitch(newBranchId: string) {
    if (!navigator.onLine) {
      toast.error('Branch switch requires an internet connection')
      return
    }
    setSwitching(true)
    try {
      const res = await fetch('/api/auth/switch-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: newBranchId }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        throw new Error(error ?? 'Switch failed')
      }
      localStorage.setItem('pos_branch_id', newBranchId)
      setBranchId(newBranchId)
      setCurrentBranch(branches.find((b) => b.id === newBranchId) ?? null)
      await replaceCatalogFromServer()
      setAuthUser((prev) => prev ? { ...prev, branchId: newBranchId } : prev)
      setBranchMenuOpen(false)
      router.refresh()
      toast.success('Branch switched')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Switch failed')
    } finally {
      setSwitching(false)
    }
  }

  async function handleLogout() {
    await logout()
    setAuthUser(null)
    router.refresh()
  }

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const visibleNav = nav.filter((item) => {
    if (item.href === '/reports' && authUser && !canViewReports(authUser)) return false
    if (item.href === '/stock-count' && authUser && !hasPermission(authUser, 'stock.count.adjust')) return false
    return true
  })

  if (!mounted) return null

  if (!branchId) {
    return (
      <BranchSetup
        onComplete={() => {
          const id = getMyBranchId()
          setBranchId(id)
          if (id) {
            getBranches().then((all) => {
              setBranches(all)
              setCurrentBranch(all.find((b) => b.id === id) ?? null)
            })
          }
        }}
      />
    )
  }

  if (!authChecked) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading…
      </div>
    )
  }

  if (!authUser) {
    return (
      <PinLogin
        branchId={branchId}
        branchName={currentBranch?.name ?? 'this branch'}
        onComplete={() => void afterLogin()}
      />
    )
  }

  if (syncing) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-500 gap-2">
        <Loader2 size={20} className="animate-spin text-blue-600" />
        Syncing catalog…
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <nav
        className={`hidden md:flex border-r border-gray-200 bg-white flex-col shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out ${
          sidebarCollapsed ? 'w-14' : 'w-56'
        }`}
      >
        <div
          className={`flex items-center shrink-0 pt-5 pb-2 ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          {!sidebarCollapsed && (
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest truncate">
              POS System
            </p>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
            className="flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        {currentBranch && (
          <div className={`mb-2 relative ${sidebarCollapsed ? 'flex justify-center px-2' : 'px-4'}`}>
            {authUser.role === 'OWNER' && !sidebarCollapsed ? (
              <div className="relative">
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => setBranchMenuOpen((o) => !o)}
                  className="w-full inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2 py-0.5 font-medium max-w-full hover:bg-blue-100 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                  <span className="truncate flex-1 text-left">{currentBranch.name}</span>
                  <ChevronDown size={10} className="shrink-0" />
                </button>
                {branchMenuOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
                    {!navigator.onLine && (
                      <p className="px-2 py-1.5 text-[10px] text-amber-600 flex items-center gap-1">
                        <WifiOff size={10} /> Offline — switch blocked
                      </p>
                    )}
                    {branches.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        disabled={switching || b.id === branchId}
                        onClick={() => handleOwnerBranchSwitch(b.id)}
                        className={`w-full text-left px-2 py-1.5 text-xs hover:bg-gray-50 ${b.id === branchId ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
                      >
                        {b.name} <span className="text-gray-400 font-mono">{b.code}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : sidebarCollapsed ? (
              <span
                className="w-2 h-2 rounded-full bg-blue-500 shrink-0"
                title={currentBranch.name}
              />
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-100 rounded-full px-2 py-0.5 font-medium max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                <span className="truncate">{currentBranch.name}</span>
              </span>
            )}
          </div>
        )}

        <div className={`flex flex-col gap-1 flex-1 pb-5 ${sidebarCollapsed ? 'px-2' : 'px-3'}`}>
          {visibleNav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              title={sidebarCollapsed ? label : undefined}
              className={`flex items-center rounded-lg text-sm transition-colors ${
                sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'gap-2.5 px-3 py-2'
              } ${navLinkClass(isActive(href))}`}
            >
              <Icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{label}</span>}
            </Link>
          ))}
        </div>

        {!sidebarCollapsed && (
          <div className="px-3 pb-4 border-t border-gray-100 pt-3 space-y-2">
            <p className="text-[10px] text-gray-500 truncate px-1">{authUser.name} · {authUser.role.toLowerCase()}</p>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        )}
      </nav>

      <main className="flex-1 overflow-hidden flex flex-col bg-white text-gray-900 min-w-0">
        {children}
      </main>

      <nav className={`md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-sm safe-area-pb ${
        deviceUiMode === 'mobile' && pathname === '/pos' ? 'hidden' : ''
      }`}>
        <div className="flex items-stretch justify-around px-1 pt-1 pb-2">
          {visibleNav.map(({ href, label, icon: Icon }) => {
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
