import { clearSession } from '@/lib/server/auth/session'

export async function POST() {
  await clearSession()
  return Response.json({ data: { ok: true }, error: null })
}
