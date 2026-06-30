import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { Role } from '@prisma/client'

export type SessionPayload = {
  userId: string
  role: Role
  branchId: string | null
  orgId: string
  name: string
}

const COOKIE_NAME = 'pos_session'
const SESSION_TTL = '12h'

function secret(): Uint8Array {
  const raw = process.env.AUTH_SECRET ?? 'dev-insecure-secret-change-me'
  return new TextEncoder().encode(raw)
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({
    userId: payload.userId,
    role: payload.role,
    branchId: payload.branchId,
    orgId: payload.orgId,
    name: payload.name,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secret())

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60,
  })
}

export async function readSession(): Promise<SessionPayload | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secret())
    return {
      userId: String(payload.userId),
      role: payload.role as Role,
      branchId: payload.branchId != null ? String(payload.branchId) : null,
      orgId: String(payload.orgId),
      name: String(payload.name),
    }
  } catch {
    return null
  }
}

export async function clearSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

export async function updateSessionBranch(branchId: string): Promise<void> {
  const current = await readSession()
  if (!current || current.role !== 'OWNER') return
  await createSession({ ...current, branchId })
}
