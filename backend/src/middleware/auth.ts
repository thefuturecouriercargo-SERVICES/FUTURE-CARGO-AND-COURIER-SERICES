import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { verifyToken, verifyVendorToken, JwtPayload, VendorJwtPayload } from "../utils/jwt";
import { ApiError } from "../utils/asyncHandler";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      vendor?: VendorJwtPayload;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[env.cookieName];
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token = cookieToken || bearerToken;

  if (!token) {
    return next(new ApiError(401, "Not authenticated"));
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired session"));
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ApiError(401, "Not authenticated"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, "You do not have permission to perform this action"));
    }
    next();
  };
}

// Vendors log in through a completely separate session (their own cookie), so a
// vendor's access never overlaps with staff (SUPER_ADMIN/MANAGER/DRIVER) sessions.
export function authenticateVendor(req: Request, _res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[env.vendorCookieName];
  const header = req.headers.authorization;
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token = cookieToken || bearerToken;

  if (!token) {
    return next(new ApiError(401, "Not authenticated"));
  }

  try {
    const payload = verifyVendorToken(token);
    if (payload.type !== "VENDOR") throw new Error("wrong token type");
    req.vendor = payload;
    next();
  } catch {
    next(new ApiError(401, "Invalid or expired session"));
  }
}
