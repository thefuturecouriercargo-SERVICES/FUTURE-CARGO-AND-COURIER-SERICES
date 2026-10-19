import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { initSocket } from "./lib/socket";
import { prisma } from "./lib/prisma";
import { backfillResolvedAt } from "./services/resolvedAt.backfill";
import { startWeeklyBackupScheduler } from "./services/backup.service";
import { startWooSyncScheduler } from "./services/inspiredWoo.service";
import { startPhotoPruneScheduler } from "./services/photoReader.service";
import { runVendorLoginResetOnce } from "./services/vendorLogin.service";

async function main() {
  const app = createApp();
  const httpServer = http.createServer(app);

  initSocket(httpServer);

  // Ensure Order.resolvedAt exists and is filled for older orders, before serving.
  await backfillResolvedAt();

  httpServer.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Future Courier API listening on port ${env.port} [${env.nodeEnv}]`);
  });

  // Weekly backup email (no-op until RESEND_API_KEY + BACKUP_EMAIL_TO are set).
  startWeeklyBackupScheduler();

  // Inspired website orders → Awaiting Pickup every 5 min (no-op until configured).
  startWooSyncScheduler();
  startPhotoPruneScheduler();
  void runVendorLoginResetOnce();

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}, shutting down gracefully...`);
    httpServer.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error starting server", err);
  process.exit(1);
});
