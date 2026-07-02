import type { PermissionKey } from '@/lib/permissions'
import type { AuthUser } from './guard'
import { hasPermission } from './permissions'

export type ServerTransactionType =
  | 'SALE'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'RETURN'
  | 'TRANSFER_OUT'

export const PERMISSION_BY_TRANSACTION_TYPE: Record<ServerTransactionType, PermissionKey> = {
  ADJUSTMENT: 'stock.count.adjust',
  PURCHASE: 'stock.purchase.receive',
  SALE: 'sales.create',
  TRANSFER_OUT: 'stock.transfer.initiate',
  RETURN: 'sales.void',
}

export function getTransactionPermission(type: string): PermissionKey | undefined {
  return PERMISSION_BY_TRANSACTION_TYPE[type as ServerTransactionType]
}

export type SyncItemStatus = 'ok' | 'forbidden' | 'invalid_type'

export function classifySyncItem(
  type: string,
  permissionGranted: Map<string, boolean>,
): SyncItemStatus {
  const permission = getTransactionPermission(type)
  if (!permission) return 'invalid_type'
  if (!permissionGranted.get(type)) return 'forbidden'
  return 'ok'
}

/** Resolve permission once per distinct type in a batch. */
export async function resolveTransactionTypePermissions(
  user: AuthUser,
  types: Iterable<string>,
): Promise<Map<string, boolean>> {
  const granted = new Map<string, boolean>()
  const distinct = new Set(types)

  await Promise.all(
    [...distinct].map(async (type) => {
      const permission = getTransactionPermission(type)
      if (!permission) return
      granted.set(type, await hasPermission(user, permission))
    }),
  )

  return granted
}
