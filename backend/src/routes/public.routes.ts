import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiError } from "../utils/asyncHandler";
import { emitGlobal } from "../lib/socket";

/**
 * Public customer order link: /order/<VENDOR>. The customer fills their delivery
 * details + current location; the vendor accepts it in their portal. No login.
 * Only vendors listed in CUSTOMER_LINK_VENDORS (default ZZAISHA) have a link.
 */
const router = Router();

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const customerLinkVendors = () =>
  (process.env.CUSTOMER_LINK_VENDORS || "ZZAISHA")
    .split(",")
    .map(key)
    .filter(Boolean);

export async function linkVendor(slug: string) {
  const k = key(slug);
  if (!k || !customerLinkVendors().includes(k)) return null;
  const vendors = await prisma.vendor.findMany({ where: { active: true }, select: { id: true, name: true, username: true } });
  return vendors.find((v) => key(v.username ?? "") === k || key(v.name) === k) ?? null;
}

export const isCustomerLinkVendor = (v: { name: string; username?: string | null }) =>
  customerLinkVendors().some((k) => k === key(v.username ?? "") || k === key(v.name));

const digits = (p: string) => {
  let d = p.replace(/\D/g, "");
  if (d.startsWith("00971")) d = d.slice(5);
  else if (d.startsWith("971")) d = d.slice(3);
  return d.replace(/^0+/, "");
};

const sendLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });
const lookupLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.get(
  "/vendor/:slug",
  asyncHandler(async (req, res) => {
    const v = await linkVendor(req.params.slug);
    if (!v) throw new ApiError(404, "This order link isn't active");
    res.json({ name: v.name });
  })
);

// "Login" with name + phone: returns the address they gave last time (both must match).
router.post(
  "/vendor/:slug/lookup",
  lookupLimiter,
  asyncHandler(async (req, res) => {
    const v = await linkVendor(req.params.slug);
    if (!v) throw new ApiError(404, "This order link isn't active");
    const { name, phone } = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().min(5).max(30) }).parse(req.body);
    const last = await prisma.customerRequest.findFirst({
      where: { vendorId: v.id, phoneDigits: digits(phone) },
      orderBy: { createdAt: "desc" },
    });
    const first = (s: string) => s.trim().split(/\s+/)[0].toLowerCase();
    if (!last || first(last.customerName) !== first(name)) return res.json({ found: false });
    res.json({
      found: true,
      customerName: last.customerName,
      address: last.address,
      emirate: last.emirate,
      landmark: last.landmark,
      lat: last.lat,
      lng: last.lng,
    });
  })
);

router.post(
  "/vendor/:slug/request",
  sendLimiter,
  asyncHandler(async (req, res) => {
    const v = await linkVendor(req.params.slug);
    if (!v) throw new ApiError(404, "This order link isn't active");
    const b = z
      .object({
        customerName: z.string().trim().min(2, "Please enter your name").max(120),
        customerPhone: z.string().trim().min(7, "Please enter your phone number").max(30).regex(/^[0-9+()\-\s]+$/, "Phone can only contain digits"),
        address: z.string().trim().min(5, "Please enter your address").max(500),
        emirate: z.string().trim().min(2).max(30),
        landmark: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(500).optional(),
        lat: z.number().min(22).max(27).optional(),
        lng: z.number().min(51).max(57).optional(),
        website: z.string().optional(), // honeypot — real people leave it empty
      })
      .parse(req.body);
    if (b.website) return res.json({ ok: true });
    const r = await prisma.customerRequest.create({
      data: {
        vendorId: v.id,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        phoneDigits: digits(b.customerPhone),
        address: b.address,
        emirate: b.emirate.toUpperCase(),
        landmark: b.landmark || null,
        notes: b.notes || null,
        lat: b.lat ?? null,
        lng: b.lng ?? null,
      },
    });
    emitGlobal("customer-request:new", { vendorId: v.id, id: r.id });
    res.json({ ok: true });
  })
);

export default router;
