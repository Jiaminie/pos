import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, assertBranchAccess, requirePermission, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function GET(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user
  const denied = await requirePermission(user, 'stock.view')
  if (!isAuthUser(denied)) return denied

  try {
    const { searchParams } = new URL(request.url)
    const branchId  = searchParams.get('branchId')
    const direction = searchParams.get('direction') ?? 'all'
    const status    = searchParams.get('status') ?? undefined

    if (!branchId) {
      return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
    }

    const branchErr = assertBranchAccess(user, branchId)
    if (branchErr) return branchErr

    const where = {
      ...(direction === 'incoming' ? { toBranchId: branchId }   : {}),
      ...(direction === 'outgoing' ? { fromBranchId: branchId } : {}),
      ...(direction === 'all'      ? { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] } : {}),
      ...(status ? { status: status as never } : {}),
    }

    const transfers = await prisma.stockTransfer.findMany({
      where,
      include: { product: { select: { name: true, sku: true } }, fromBranch: true, toBranch: true },
      orderBy: { createdAt: 'desc' },
    })

    return Response.json({ data: transfers, error: null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'stock.transfer.initiate')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const { fromBranchId, toBranchId, productId, quantity, note, fromDeviceId } = body

    if (!fromBranchId || !toBranchId || !productId || !quantity || !fromDeviceId) {
      return Response.json(
        { data: null, error: 'fromBranchId, toBranchId, productId, quantity, fromDeviceId are required' },
        { status: 400 },
      )
    }

    const branchErr = assertBranchAccess(user, fromBranchId)
    if (branchErr) return branchErr

    if (fromBranchId === toBranchId) {
      return Response.json(
        { data: null, error: 'Source and destination branches must differ' },
        { status: 400 },
      )
    }

    if (Number(quantity) <= 0) {
      return Response.json({ data: null, error: 'Quantity must be positive' }, { status: 400 })
    }

    const [transfer, transaction] = await prisma.$transaction([
      prisma.stockTransfer.create({
        data: {
          fromBranchId,
          toBranchId,
          productId,
          quantity,
          status: 'PENDING',
          note: note?.trim() || null,
          fromDeviceId,
        },
      }),
      prisma.inventoryTransaction.create({
        data: {
          productId,
          type: 'TRANSFER_OUT',
          branchId: fromBranchId,
          quantity,
          deviceId: fromDeviceId,
          syncedAt: new Date(),
        },
      }),
    ])

    return Response.json({ data: { transfer, transaction }, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
