import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { requireUser, isAuthUser, requireUserWithPermission } from '@/lib/server/auth/guard'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserWithPermission(request, 'admin.branch.manage')
  if (!isAuthUser(user)) return user

  try {
    const { id } = await params
    const body = await request.json()
    const { name, code, address, isPrimary } = body

    const branch = await prisma.branch.findUnique({ where: { id } })
    if (!branch || branch.archived) {
      return Response.json({ data: null, error: 'Branch not found' }, { status: 404 })
    }

    if (code !== undefined) {
      const upperCode = (code as string).trim().toUpperCase()
      if (!upperCode) {
        return Response.json({ data: null, error: 'Code cannot be empty' }, { status: 400 })
      }
      const duplicate = await prisma.branch.findFirst({
        where: { organizationId: branch.organizationId, code: upperCode, id: { not: id } },
      })
      if (duplicate) {
        return Response.json(
          { data: null, error: `Branch code "${upperCode}" already exists in this organization` },
          { status: 409 },
        )
      }
    }

    if (isPrimary === true && !branch.isPrimary) {
      // Demote current primary, promote this one — in a transaction
      await prisma.$transaction([
        prisma.branch.updateMany({
          where: { organizationId: branch.organizationId, isPrimary: true },
          data: { isPrimary: false },
        }),
        prisma.branch.update({
          where: { id },
          data: { isPrimary: true },
        }),
      ])

      const updated = await prisma.branch.findUnique({ where: { id } })
      return Response.json({ data: updated, error: null })
    }

    const updated = await prisma.branch.update({
      where: { id },
      data: {
        ...(name !== undefined     && { name: name.trim() }),
        ...(code !== undefined     && { code: (code as string).trim().toUpperCase() }),
        ...(address !== undefined  && { address: address?.trim() || null }),
      },
    })

    return Response.json({ data: updated, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUserWithPermission(request, 'admin.branch.manage')
  if (!isAuthUser(user)) return user

  try {
    const { id } = await params

    const branch = await prisma.branch.findUnique({ where: { id } })
    if (!branch || branch.archived) {
      return Response.json({ data: null, error: 'Branch not found' }, { status: 404 })
    }

    if (branch.isPrimary) {
      return Response.json(
        { data: null, error: 'Cannot delete the primary branch. Set another branch as primary first.' },
        { status: 400 },
      )
    }

    await prisma.branch.update({
      where: { id },
      data: { archived: true },
    })

    return Response.json({ data: { id }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
