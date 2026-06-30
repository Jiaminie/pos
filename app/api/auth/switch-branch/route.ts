import { NextRequest } from 'next/server'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'
import { updateSessionBranch } from '@/lib/server/auth/session'
import { prisma } from '@/lib/server/db'

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'admin.branch.switch')
  if (!isAuthUser(user)) return user

  try {
    const { branchId } = await request.json()
    if (!branchId) {
      return Response.json({ data: null, error: 'branchId is required' }, { status: 400 })
    }

    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: user.orgId },
    })
    if (!branch) {
      return Response.json({ data: null, error: 'Branch not found' }, { status: 404 })
    }

    await updateSessionBranch(branchId)
    return Response.json({ data: { branchId }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
