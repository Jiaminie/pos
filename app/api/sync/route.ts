import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, canAccessBranch, type AuthUser } from '@/lib/server/auth/guard'
import {
  classifySyncItem,
  resolveTransactionTypePermissions,
} from '@/lib/server/auth/transactionPermissions'

type IncomingTransaction = {
  id?: string
  productId: string
  type: 'SALE' | 'PURCHASE' | 'ADJUSTMENT' | 'RETURN' | 'TRANSFER_OUT'
  source?: 'SUPPLIER' | 'INTERBRANCH' | 'CORRECTION' | null
  sourceBranchId?: string | null
  branchId?: string | null
  quantity: number
  unitPrice?: number | null
  deviceId: string
  createdAt?: string
}

type SyncItemStatus = 'ok' | 'forbidden' | 'invalid_type'

function itemStatus(
  tx: IncomingTransaction,
  user: AuthUser,
  permissionGranted: Map<string, boolean>,
): SyncItemStatus {
  if (!tx.id) return 'invalid_type'
  const typeStatus = classifySyncItem(tx.type, permissionGranted)
  if (typeStatus !== 'ok') return typeStatus
  if (!canAccessBranch(user, tx.branchId)) return 'forbidden'
  return 'ok'
}

export async function POST(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()

    if (!Array.isArray(body)) {
      return Response.json(
        { data: null, error: 'Body must be an array of transactions' },
        { status: 400 },
      )
    }

    const incoming: IncomingTransaction[] = body

    const permissionGranted = await resolveTransactionTypePermissions(
      user,
      incoming.map((tx) => tx.type),
    )

    const allowed = incoming.filter((tx) => itemStatus(tx, user, permissionGranted) === 'ok')
    const syncedAt = new Date()

    const syncedById = new Map<string, Date>()

    if (allowed.length > 0) {
      const created = await prisma.$transaction(
        allowed.map((tx) =>
          prisma.inventoryTransaction.upsert({
            where: { id: tx.id ?? '' },
            update: { syncedAt },
            create: {
              ...(tx.id ? { id: tx.id } : {}),
              productId: tx.productId,
              type: tx.type,
              source: tx.source ?? null,
              sourceBranchId: tx.sourceBranchId ?? null,
              branchId: tx.branchId ?? null,
              quantity: tx.quantity,
              unitPrice: tx.unitPrice ?? null,
              deviceId: tx.deviceId,
              createdAt: tx.createdAt ? new Date(tx.createdAt) : undefined,
              syncedAt,
            },
          }),
        ),
      )

      for (const t of created) {
        if (t.syncedAt) syncedById.set(t.id, t.syncedAt)
      }
    }

    const results = incoming.map((tx) => {
      const status = itemStatus(tx, user, permissionGranted)
      if (status === 'ok' && tx.id) {
        return {
          id: tx.id,
          status,
          syncedAt: syncedById.get(tx.id) ?? syncedAt,
        }
      }
      return { id: tx.id ?? '', status }
    })

    return Response.json({ data: { results }, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
