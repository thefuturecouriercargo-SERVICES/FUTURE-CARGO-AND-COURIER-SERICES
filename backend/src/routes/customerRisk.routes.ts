import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate } from "../middleware/auth";
import { phoneHistory, riskForPhones } from "../lib/customerRisk";
import { z } from "zod";

/** Staff (admin, manager, driver): has this customer refused (RTO) parcels before? */
const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const phone = String(req.query.phone ?? "");
    const excludeCn = req.query.excludeCn ? Number(req.query.excludeCn) : undefined;
    const h = await phoneHistory(phone, { excludeCn });
    if (!h) return res.json({ cancelled: 0, delivered: 0, level: "none", orders: [] });
    // Drivers only need the counts and the last few reasons, not the full list.
    if (req.user!.role === "DRIVER") {
      return res.json({ ...h, orders: h.orders.filter((o) => o.status === "CANCELLED").slice(0, 3) });
    }
    res.json(h);
  })
);

router.post(
  "/batch",
  asyncHandler(async (req, res) => {
    const { phones } = z.object({ phones: z.array(z.string().max(40)).max(1000) }).parse(req.body);
    res.json(await riskForPhones(phones));
  })
);

export default router;
