import { readSession } from '@/lib/server/auth/session'
import { getEffectivePermissions } from '@/lib/server/auth/permissions'

export async function GET() {
  const session = await readSession()
  if (!session) {
    return Response.json({ data: null, error: 'Not authenticated' }, { status: 401 })
  }

  const permissions = [...(await getEffectivePermissions(session))]

  return Response.json({
    data: {
      userId: session.userId,
      name: session.name,
      role: session.role,
      branchId: session.branchId,
      orgId: session.orgId,
      permissions,
    },
    error: null,
  })
}
