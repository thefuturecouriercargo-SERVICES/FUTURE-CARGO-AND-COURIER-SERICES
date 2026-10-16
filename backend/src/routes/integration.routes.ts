import { Router } from "express";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { wooConnections, wooConfig, lastWooSync, syncWooOrders, testWooConnection } from "../services/inspiredWoo.service";

// Office-only controls for connected vendor websites. Never returns keys/secrets.
const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN", "MANAGER"));

function connFrom(param: string) {
  const conn = param.toUpperCase();
  if (!wooConnections().includes(conn)) throw new ApiError(404, "Unknown website connection");
  return conn;
}

function status(conn: string) {
  const cfg = wooConfig(conn);
  return { conn, configured: cfg.configured, url: cfg.url || null, vendorName: cfg.vendorName, statuses: cfg.statuses, lastSync: lastWooSync(conn) };
}

// Every connection key, so the office sees one box per vendor website.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(wooConnections().map(status));
  })
);

router.get(
  "/:conn/status",
  asyncHandler(async (req, res) => {
    res.json(status(connFrom(req.params.conn)));
  })
);

router.post(
  "/:conn/test",
  asyncHandler(async (req, res) => {
    const conn = connFrom(req.params.conn);
    try {
      res.json({ ok: true, orders: await testWooConnection(conn) });
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Connection failed");
    }
  })
);

router.post(
  "/:conn/sync",
  asyncHandler(async (req, res) => {
    const conn = connFrom(req.params.conn);
    try {
      res.json(await syncWooOrders(conn, req.user!.sub));
    } catch (err) {
      throw new ApiError(400, err instanceof Error ? err.message : "Sync failed");
    }
  })
);

export default router;
