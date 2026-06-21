import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action, deviceId } = body

    if (!action || !['confirm', 'reject'].includes(action)) {
      return Response.json(
        { data: null, error: 'action must be "confirm" or "reject"' },
        { status: 400 },
      )
    }

    const transfer = await prisma.stockTransfer.findUnique({ where: { id } })
    if (!transfer) {
      return Response.json({ data: null, error: 'Transfer not found' }, { status: 404 })
    }

    if (transfer.status !== 'PENDING' && transfer.status !== 'IN_TRANSIT') {
      return Response.json(
        { data: null, error: `Transfer is already ${transfer.status.toLowerCase()}` },
        { status: 409 },
      )
    }

    const now = new Date()

    if (action === 'confirm') {
      const [updated, transaction] = await prisma.$transaction([
        prisma.stockTransfer.update({
          where: { id },
          data: { status: 'RECEIVED', receivedAt: now, toDeviceId: deviceId ?? null },
        }),
        // PURCHASE on server = STOCK_IN on client; source INTERBRANCH marks it as a transfer receipt
        prisma.inventoryTransaction.create({
          data: {
            productId:     transfer.productId,
            type:          'PURCHASE',
            branchId:      transfer.toBranchId,
            source:        'INTERBRANCH',
            sourceBranchId: transfer.fromBranchId,
            quantity:      transfer.quantity,
            deviceId:      deviceId ?? 'server',
            syncedAt:      now,
          },
        }),
      ])
      return Response.json({ data: { transfer: updated, transaction }, error: null })
    }

    // action === 'reject': mark rejected + create reversal STOCK_IN on the sender's branch
    const [updated, reversal] = await prisma.$transaction([
      prisma.stockTransfer.update({
        where: { id },
        data: { status: 'REJECTED' },
      }),
      prisma.inventoryTransaction.create({
        data: {
          productId: transfer.productId,
          type:      'PURCHASE',
          branchId:  transfer.fromBranchId,
          source:    'CORRECTION',
          quantity:  transfer.quantity,
          deviceId:  deviceId ?? 'server',
          syncedAt:  now,
        },
      }),
    ])

    return Response.json({ data: { transfer: updated, reversal }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
