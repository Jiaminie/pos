import { NextRequest } from 'next/server'
import { prisma } from '@/lib/server/db'
import { verifyPin, validatePinFormat } from '@/lib/server/auth/pin'
import { createSession } from '@/lib/server/auth/session'
import { clearAttempts, isLockedOut, recordFailedAttempt } from '@/lib/server/auth/lockout'
import { logAudit } from '@/lib/server/audit'
import type { Role } from '@prisma/client'

function callerId(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for')
  return fwd?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pin, branchId } = body as { pin?: string; branchId?: string }

    if (!pin || !branchId) {
      return Response.json(
        { data: null, error: 'pin and branchId are required' },
        { status: 400 },
      )
    }

    const pinErr = validatePinFormat(pin)
    if (pinErr) {
      return Response.json({ data: null, error: pinErr }, { status: 400 })
    }

    const caller = callerId(request)
    if (isLockedOut(branchId, caller)) {
      return Response.json(
        { data: null, error: 'Too many failed attempts. Try again in 15 minutes.' },
        { status: 429 },
      )
    }

    const branch = await prisma.branch.findUnique({ where: { id: branchId } })
    if (!branch || branch.archived) {
      return Response.json({ data: null, error: 'Branch not found' }, { status: 404 })
    }

    const users = await prisma.user.findMany({
      where: {
        organizationId: branch.organizationId,
        active: true,
        OR: [
          { role: 'OWNER' as Role },
          { branchId },
        ],
      },
    })

    let matched: (typeof users)[0] | null = null
    for (const user of users) {
      if (await verifyPin(pin, user.pinHash)) {
        matched = user
        break
      }
    }

    if (!matched) {
      const remaining = recordFailedAttempt(branchId, caller)
      return Response.json(
        { data: null, error: `Invalid PIN. ${remaining} attempt(s) remaining.` },
        { status: 401 },
      )
    }

    if (matched.role !== 'OWNER' && matched.branchId !== branchId) {
      return Response.json(
        { data: null, error: 'This account is not assigned to this branch' },
        { status: 403 },
      )
    }

    clearAttempts(branchId, caller)

    const sessionBranchId = matched.role === 'OWNER' ? branchId : matched.branchId

    await createSession({
      userId: matched.id,
      role: matched.role,
      branchId: sessionBranchId,
      orgId: matched.organizationId,
      name: matched.name,
    })

    await logAudit({
      organizationId: matched.organizationId,
      actorId: matched.id,
      actorName: matched.name,
      action: 'LOGIN',
      branchId: sessionBranchId,
      metadata: { role: matched.role },
    })

    return Response.json({
      data: {
        userId: matched.id,
        name: matched.name,
        role: matched.role,
        branchId: sessionBranchId,
        orgId: matched.organizationId,
      },
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
