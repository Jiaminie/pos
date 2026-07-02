import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { assertBranchAccess, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'
import { resolveStockCountBranchId } from '@/lib/server/stock-count/branch'

type CompletionStatus = 'SUBMITTED' | 'DISCARDED'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'stock.count.adjust')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const { ids, status } = body as { ids?: unknown; status?: unknown; branchId?: string }

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ data: null, error: 'ids must be a non-empty array' }, { status: 400 })
    }

    if (status !== 'SUBMITTED' && status !== 'DISCARDED') {
      return Response.json(
        { data: null, error: 'status must be SUBMITTED or DISCARDED' },
        { status: 400 },
      )
    }

    const stringIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (stringIds.length !== ids.length) {
      return Response.json({ data: null, error: 'Every id must be a non-empty string' }, { status: 400 })
    }

    const branchId = resolveStockCountBranchId(body.branchId, user)
    if (!branchId) {
      return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
    }

    const branchErr = assertBranchAccess(user, branchId)
    if (branchErr) return branchErr

    const existing = await prisma.stockCountUpload.findMany({
      where: {
        id: { in: stringIds },
        uploadedById: user.userId,
        branchId,
      },
      select: { id: true, branchId: true },
    })

    if (existing.length !== stringIds.length) {
      return Response.json(
        { data: null, error: 'One or more uploads were not found or are not owned by you' },
        { status: 404 },
      )
    }

    const now = new Date()
    await prisma.stockCountUpload.updateMany({
      where: {
        id: { in: stringIds },
        uploadedById: user.userId,
        branchId,
      },
      data: {
        status: status as CompletionStatus,
        submittedAt: status === 'SUBMITTED' ? now : null,
        updatedAt: now,
      },
    })

    const uploads = await prisma.stockCountUpload.findMany({
      where: { id: { in: stringIds } },
      orderBy: { createdAt: 'desc' },
    })

    return Response.json({ data: { uploads }, error: null }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
