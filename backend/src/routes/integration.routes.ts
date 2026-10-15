import { Router } from "express";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { inspiredConfig, lastInspiredSync, syncInspiredOrders, testInspiredConnection } from "../services/inspiredWoo.service";

// Office-only controls for the Inspired website connection. Never returns the key/secret.
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

router.get(
  "/inspired/status",
  asyncHandler(async (_req, res) => {
    const cfg = inspiredConfig();
    res.json({ configured: cfg.configured, url: cfg.url || null, vendorName: cfg.vendorName, statuses: cfg.statuses, lastSync: lastInspiredSync() });
  })
);

router.post(
  "/inspired/test",
  asyncHandler(async (_req, res) => {
    try {
      res.json({ ok: true, orders: await testInspiredConnection() });
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Connection failed");
    }
  })
);

router.post(
  "/inspired/sync",
  asyncHandler(async (req, res) => {
    try {
      res.json(await syncInspiredOrders(req.user!.sub));
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Sync failed");
    }
  })
);

export default router;
