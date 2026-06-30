export const PERMISSION_GROUPS = {
  catalog: 'Catalog',
  stock: 'Stock',
  sales: 'Sales',
  reports: 'Reports',
  admin: 'Admin',
} as const

export type PermissionGroup = keyof typeof PERMISSION_GROUPS
export type PermissionScope = 'org' | 'branch' | 'self'

export const PERMISSION_KEYS = [
  'catalog.product.manage',
  'catalog.price.selling',
  'catalog.price.cost_and_floor',
  'catalog.taxonomy.manage',
  'stock.count.adjust',
  'stock.purchase.receive',
  'stock.transfer.initiate',
  'stock.transfer.receive',
  'stock.view',
  'sales.create',
  'sales.discount',
  'sales.void',
  'incident.create',
  'reports.view.own',
  'reports.view.branch',
  'reports.view.org',
  'users.manage.cashiers',
  'admin.settings',
  'admin.branch.manage',
  'admin.branch.switch',
  'admin.users.manage_managers',
  'admin.permissions.configure',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export type PermissionMeta = {
  key: PermissionKey
  group: PermissionGroup
  label: string
  scope: PermissionScope
  togglable: boolean
  defaults: { MANAGER: boolean; CASHIER: boolean }
}

export const PERMISSION_CATALOG: PermissionMeta[] = [
  {
    key: 'catalog.product.manage',
    group: 'catalog',
    label: 'Edit products (image, bulk, delete)',
    scope: 'org',
    togglable: true,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'catalog.price.selling',
    group: 'catalog',
    label: 'Edit selling prices',
    scope: 'org',
    togglable: true,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'catalog.price.cost_and_floor',
    group: 'catalog',
    label: 'View/edit cost & floor prices',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'catalog.taxonomy.manage',
    group: 'catalog',
    label: 'Manage brands, categories & units',
    scope: 'org',
    togglable: true,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'stock.count.adjust',
    group: 'stock',
    label: 'Stock count adjustments',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'stock.purchase.receive',
    group: 'stock',
    label: 'Receive purchases / stock-in',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'stock.transfer.initiate',
    group: 'stock',
    label: 'Initiate stock transfers',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'stock.transfer.receive',
    group: 'stock',
    label: 'Receive stock transfers',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'stock.view',
    group: 'stock',
    label: 'View stock & transactions',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: true },
  },
  {
    key: 'sales.create',
    group: 'sales',
    label: 'Complete sales',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: true },
  },
  {
    key: 'sales.discount',
    group: 'sales',
    label: 'Apply discounts (above floor)',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: true },
  },
  {
    key: 'sales.void',
    group: 'sales',
    label: 'Void / refund sales (approve)',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'incident.create',
    group: 'sales',
    label: 'Log customer incidents',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: true },
  },
  {
    key: 'reports.view.own',
    group: 'reports',
    label: 'View own sales reports',
    scope: 'self',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'reports.view.branch',
    group: 'reports',
    label: 'View branch reports',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'reports.view.org',
    group: 'reports',
    label: 'View org-wide reports',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'users.manage.cashiers',
    group: 'admin',
    label: 'Manage cashiers',
    scope: 'branch',
    togglable: true,
    defaults: { MANAGER: true, CASHIER: false },
  },
  {
    key: 'admin.settings',
    group: 'admin',
    label: 'Store settings',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'admin.branch.manage',
    group: 'admin',
    label: 'Create & edit branches',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'admin.branch.switch',
    group: 'admin',
    label: 'Switch active branch',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'admin.users.manage_managers',
    group: 'admin',
    label: 'Manage managers',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
  {
    key: 'admin.permissions.configure',
    group: 'admin',
    label: 'Configure role permissions',
    scope: 'org',
    togglable: false,
    defaults: { MANAGER: false, CASHIER: false },
  },
]

export const TOGGLABLE_PERMISSIONS = PERMISSION_CATALOG.filter((p) => p.togglable)
export const OWNER_ONLY_PERMISSIONS = new Set(
  PERMISSION_CATALOG.filter((p) => !p.togglable).map((p) => p.key),
)

const CATALOG_BY_KEY = new Map(PERMISSION_CATALOG.map((p) => [p.key, p]))

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value)
}

export function isOwnerOnlyPermission(key: PermissionKey): boolean {
  return OWNER_ONLY_PERMISSIONS.has(key)
}

export function getPermissionMeta(key: PermissionKey): PermissionMeta | undefined {
  return CATALOG_BY_KEY.get(key)
}
