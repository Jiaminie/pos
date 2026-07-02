import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId') ?? undefined

    const branches = await prisma.branch.findMany({
      where: {
        archived: false,
        ...(organizationId ? { organizationId } : {}),
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    })

    return Response.json(
      { data: branches, error: null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const user = await requireUserWithPermission(request, 'admin.branch.manage')
  if (!isAuthUser(user)) return user

  try {
    const body = await request.json()
    const { organizationId, name, code, address } = body

    if (!organizationId || !name?.trim() || !code?.trim()) {
      return Response.json(
        { data: null, error: 'organizationId, name, and code are required' },
        { status: 400 },
      )
    }

    const upperCode = (code as string).trim().toUpperCase()

    const existing = await prisma.branch.findFirst({
      where: { organizationId, code: upperCode },
    })
    if (existing) {
      return Response.json(
        { data: null, error: `Branch code "${upperCode}" already exists in this organization` },
        { status: 409 },
      )
    }

    const branch = await prisma.branch.create({
      data: {
        organizationId,
        name: name.trim(),
        code: upperCode,
        address: address?.trim() || null,
        isPrimary: false,
      },
    })

    return Response.json({ data: branch, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
