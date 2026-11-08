import http from "http";
import { createApp } from "./app";
import { env } from "./config/env";
import { initSocket } from "./lib/socket";
import { prisma } from "./lib/prisma";
import { backfillResolvedAt } from "./services/resolvedAt.backfill";
import { startWeeklyBackupScheduler } from "./services/backup.service";
import { startNightlyBackupScheduler, nightlyConfigured } from "./services/nightlyBackup.service";
import { startWooSyncScheduler } from "./services/inspiredWoo.service";
import { startPhotoPruneScheduler } from "./services/photoReader.service";
import { runVendorLoginResetOnce } from "./services/vendorLogin.service";
import { fixOtherEmirates, fixOutsideEmirates } from "./services/inspiredWoo.service";
import { startAzanPushScheduler } from "./services/azanPush.service";

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

  // Weekly backup email — only when the nightly backup isn't running, since the
  // nightly one already emails the file every night.
  if (!nightlyConfigured()) startWeeklyBackupScheduler();
  // Nightly backup to the storage bucket (after 3 AM Dubai, last 60 kept).
  startNightlyBackupScheduler();

  // Inspired website orders → Awaiting Pickup every 5 min (no-op until configured).
  startWooSyncScheduler();
  startPhotoPruneScheduler();
  // Azan push notifications to drivers at each prayer time.
  startAzanPushScheduler();
  void runVendorLoginResetOnce();
  void fixOtherEmirates()
    .then((n) => n && console.log(`[emirates] fixed ${n} parcel(s) saved as OTHER`))
    .catch((err) => console.error("[emirates] fix failed", err));
  void fixOutsideEmirates()
    .then((n) => n && console.log(`[emirates] moved ${n} parcel(s) to the outside emirate their address names`))
    .catch((err) => console.error("[emirates] outside fix failed", err));

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
