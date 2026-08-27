import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { verifyPassword } from "../utils/password";
import { signVendorToken } from "../utils/jwt";
import { env } from "../config/env";
import { authenticateVendor } from "../middleware/auth";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const cookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "none" as const,
  maxAge: 1000 * 60 * 60 * 12, // 12h
  path: "/",
};

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const vendor = await prisma.vendor.findFirst({
      where: { active: true, username: username.trim() },
    });

    if (!vendor || !vendor.passwordHash) throw new ApiError(401, "Invalid username or password");

    const valid = await verifyPassword(password, vendor.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid username or password");

    const token = signVendorToken({
      sub: vendor.id,
      type: "VENDOR",
      username: vendor.username!,
      name: vendor.name,
    });

    res.cookie(env.vendorCookieName, token, cookieOptions);

    res.json({
      token,
      vendor: { id: vendor.id, name: vendor.name, username: vendor.username },
    });
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie(env.vendorCookieName, { path: "/" });
  res.json({ success: true });
});

router.get(
  "/me",
  authenticateVendor,
  asyncHandler(async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { id: req.vendor!.sub } });
    if (!vendor || !vendor.active) throw new ApiError(401, "Not authenticated");
    res.json({ id: vendor.id, name: vendor.name, username: vendor.username });
  })
);

export default router;
