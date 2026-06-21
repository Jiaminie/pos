import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, address, isPrimary } = body

    const branch = await prisma.branch.findUnique({ where: { id } })
    if (!branch) {
      return Response.json({ data: null, error: 'Branch not found' }, { status: 404 })
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
        ...(address !== undefined  && { address: address?.trim() || null }),
      },
    })

    return Response.json({ data: updated, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
