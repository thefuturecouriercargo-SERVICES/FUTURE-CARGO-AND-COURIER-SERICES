import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

const router = Router();
router.use(authenticate, requireRole("SUPER_ADMIN"));

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const take = req.query.limit ? Math.min(Number(req.query.limit), 500) : 200;
    const skip = req.query.offset ? Number(req.query.offset) : 0;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        include: { user: { select: { name: true, username: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      prisma.auditLog.count(),
    ]);

    res.json({ logs, total });
  })
);

export default router;
