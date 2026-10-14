import { Router } from "express";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";

// Read-only helper for the admin Scan Test page: given whatever text a barcode
// contained, find every number in it and check which ones match an existing CN.
const router = Router();
router.use(authenticate);

router.get(
  "/lookup",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const code = String(req.query.code ?? "").trim();
    if (!code) throw new ApiError(400, "Nothing to look up");
    if (code.length > 2000) throw new ApiError(400, "Code too long");

    // Every run of 3+ digits, with and without leading zeros (e.g. "0045123" → 45123).
    const runs = code.match(/\d{3,}/g) ?? [];
    const candidates = Array.from(
      new Set(runs.map((r) => Number(r.replace(/^0+(?=\d)/, ""))).filter((n) => Number.isSafeInteger(n) && n > 0 && n <= 2147483647))
    ).slice(0, 20);

    const orders = candidates.length
      ? await prisma.order.findMany({
          where: { cnNo: { in: candidates } },
          include: { vendor: { select: { name: true } }, employee: { select: { name: true } } },
          orderBy: [{ date: "desc" }],
        })
      : [];

    // Vendor bookings: by our CN, or by the vendor's own order No. (what their barcode holds).
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          ...(candidates.length ? [{ cnNo: { in: candidates } }] : []),
          { vendorRef: code },
          ...(candidates.length ? [{ vendorRef: { in: candidates.map(String) } }] : []),
        ],
      },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    res.json({
      code,
      candidates,
      bookings: bookings.map((b) => ({
        id: b.id,
        cnNo: b.cnNo,
        vendorRef: b.vendorRef,
        vendor: b.vendor.name,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        address: b.address,
        emirate: b.emirate,
        items: b.items,
        codAmount: b.codAmount,
        notes: b.notes,
        status: b.status,
      })),
      matches: orders.map((o) => ({
        id: o.id,
        cnNo: o.cnNo,
        date: o.date,
        vendor: o.vendor.name,
        total: o.total,
        payment: o.payment,
        emirate: o.emirate,
        employee: o.employee.name,
        status: o.status,
      })),
    });
  })
);

export default router;
