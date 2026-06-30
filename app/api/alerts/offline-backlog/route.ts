import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, assertBranchAccess } from '@/lib/server/auth/guard'
import { alertOfflineBacklog } from '@/lib/server/alerts'

export async function POST(request: NextRequest) {
  const user = await requireUser(request)
  if (!isAuthUser(user)) return user

  try {
    const { branchId, count, value } = (await request.json()) as {
      branchId?: string
      count?: number
      value?: number
    }

    const targetBranch = branchId ?? user.branchId
    if (!targetBranch || !count) {
      return Response.json({ sent: false, reason: 'branchId and count required' })
    }

    const branchErr = assertBranchAccess(user, targetBranch)
    if (branchErr) return branchErr

    const branch = await prisma.branch.findUnique({
      where: { id: targetBranch },
      select: { name: true },
    })

    await alertOfflineBacklog({
      branchName: branch?.name ?? targetBranch,
      count,
      value: value ?? 0,
    })

    return Response.json({ sent: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ sent: false, error: message }, { status: 500 })
  }
}
