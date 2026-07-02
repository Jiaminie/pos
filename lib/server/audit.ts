import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/server/db'

/** Sensitive actions worth a tamper-evident record. */
export type AuditAction =
  | 'SALE_CREATE'
  | 'SALE_VOID'
  | 'DISCOUNT_APPLIED'
  | 'PERMISSION_CHANGE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'LOGIN'

export type AuditInput = {
  organizationId: string
  actorId: string
  actorName: string
  action: AuditAction
  branchId?: string | null
  approvedById?: string | null
  targetType?: string | null
  targetId?: string | null
  metadata?: Prisma.InputJsonValue
  deviceId?: string | null
  wasOffline?: boolean
}

/**
 * Append-only audit write. Deliberately swallows its own errors — a failure to
 * log must never roll back or break the action being recorded. Pass a `tx`
 * client to write inside the same transaction as that action.
 */
export async function logAudit(
  input: AuditInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.actorId,
        actorName: input.actorName,
        action: input.action,
        branchId: input.branchId ?? null,
        approvedById: input.approvedById ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata,
        deviceId: input.deviceId ?? null,
        wasOffline: input.wasOffline ?? false,
      },
    })
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err)
  }
}

/** Count an actor's voids in the recent window — feeds anomaly alerts. */
export async function recentVoidCount(
  organizationId: string,
  actorId: string,
  windowMs = 60 * 60 * 1000,
): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      organizationId,
      actorId,
      action: 'SALE_VOID',
      createdAt: { gte: new Date(Date.now() - windowMs) },
    },
  })
}
