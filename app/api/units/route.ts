import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'

export async function GET() {
  try {
    const units = await prisma.unit.findMany({ orderBy: { code: 'asc' } })
    return Response.json(
      { data: units, error: null },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const code = (body.code ?? '').toString().trim().toUpperCase()
    const name = (body.name ?? '').toString().trim()

    if (!code || !name) {
      return Response.json(
        { data: null, error: 'code and name are required' },
        { status: 400 },
      )
    }

    const unit = await prisma.unit.create({
      data: { code, name, isCustom: true },
    })
    return Response.json({ data: unit, error: null }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Unique constraint on code → meaningful message
    if (message.includes('Unique constraint') || message.includes('unique')) {
      return Response.json(
        { data: null, error: `A unit with that code already exists` },
        { status: 409 },
      )
    }
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
