import { prisma } from "../lib/prisma";

interface AuditParams {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

export async function writeAuditLog({ userId, action, entity, entityId, meta }: AuditParams) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        meta: meta ? JSON.parse(JSON.stringify(meta)) : undefined,
      },
    });
  } catch (err) {
    // Audit logging must never break the primary request flow.
    // eslint-disable-next-line no-console
    console.error("Failed to write audit log", err);
  }
}
