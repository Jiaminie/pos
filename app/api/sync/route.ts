import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!Array.isArray(body)) {
      return Response.json(
        { data: null, error: 'Body must be an array of transactions' },
        { status: 400 },
      )
    }

    const incoming: IncomingTransaction[] = body
    const syncedAt = new Date()

    const created = await prisma.$transaction(
      incoming.map((tx) =>
        prisma.inventoryTransaction.upsert({
          where: { id: tx.id ?? '' },
          update: { syncedAt },
          create: {
            ...(tx.id ? { id: tx.id } : {}),
            productId:     tx.productId,
            type:          tx.type,
            source:        tx.source ?? null,
            sourceBranchId: tx.sourceBranchId ?? null,
            branchId:      tx.branchId ?? null,
            quantity:      tx.quantity,
            unitPrice:     tx.unitPrice ?? null,
            deviceId:      tx.deviceId,
            createdAt:     tx.createdAt ? new Date(tx.createdAt) : undefined,
            syncedAt,
          },
        }),
      ),
    )

    const ack = created.map((t) => ({ id: t.id, syncedAt: t.syncedAt }))
    return Response.json({ data: { ack }, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
