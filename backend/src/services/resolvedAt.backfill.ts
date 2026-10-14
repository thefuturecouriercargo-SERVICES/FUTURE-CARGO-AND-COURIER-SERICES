import { prisma } from "../lib/prisma";

/**
 * Fills Order.resolvedAt for Delivered/Cancelled orders created before the
 * column existed. Uses the latest STATUS_UPDATE audit entry that moved the
 * order into its current status; if none exists, falls back to the order's
 * own date (for carried-over orders that is already the day it was resolved).
 *
 * Safe to run on every boot: it only touches resolved rows that are still NULL,
 * so after the first run it does nothing.
 */
export async function backfillResolvedAt(): Promise<void> {
  try {
    // Safety net in case the deploy didn't run `prisma db push` (e.g. the
    // Dockerfile's `migrate deploy` path). Matches Prisma's DateTime column type.
    await prisma.$executeRawUnsafe(`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3)`);

    const count = await prisma.$executeRawUnsafe(`
      UPDATE "orders" o
      SET "resolvedAt" = COALESCE(
        (
          SELECT MAX(a."createdAt")
          FROM "audit_logs" a
          WHERE a."entity" = 'Order'
            AND a."entityId" = o."id"
            AND a."action" = 'STATUS_UPDATE'
            AND a."meta"->>'to' = o."status"::text
        ),
        o."date"::timestamp
      )
      WHERE o."status" IN ('DELIVERED', 'CANCELLED')
        AND o."resolvedAt" IS NULL
    `);
    if (count > 0) {
      // eslint-disable-next-line no-console
      console.log(`[resolvedAt] backfilled ${count} orders`);
    }
  } catch (err) {
    // Never block startup over this.
    // eslint-disable-next-line no-console
    console.error("[resolvedAt] backfill failed", err);
  }
}
