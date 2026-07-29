import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { verifyPassword } from "../utils/password";
import { signToken } from "../utils/jwt";
import { env } from "../config/env";
import { authenticate } from "../middleware/auth";
import { writeAuditLog } from "../services/audit.service";

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const cookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax" as const,
  maxAge: 1000 * 60 * 60 * 12, // 12h
  path: "/",
};

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        active: true,
        OR: [{ username: username.trim() }, { email: username.trim() }],
      },
    });

    if (!user) throw new ApiError(401, "Invalid username or password");

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new ApiError(401, "Invalid username or password");

    const token = signToken({
      sub: user.id,
      role: user.role,
      username: user.username,
      name: user.name,
    });

    res.cookie(env.cookieName, token, cookieOptions);
    await writeAuditLog({ userId: user.id, action: "LOGIN", entity: "User", entityId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  })
);

router.post("/logout", (req, res) => {
  res.clearCookie(env.cookieName, { path: "/" });
  res.json({ success: true });
});

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user || !user.active) throw new ApiError(401, "Not authenticated");
    res.json({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      phone: user.phone,
    });
  })
);

export default router;
