import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { Role } from "@prisma/client";

export interface JwtPayload {
  sub: string;
  role: Role;
  username: string;
  name: string;
}

export interface VendorJwtPayload {
  sub: string;
  type: "VENDOR";
  username: string;
  name: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

export function signVendorToken(payload: VendorJwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyVendorToken(token: string): VendorJwtPayload {
  return jwt.verify(token, env.jwtSecret) as VendorJwtPayload;
}
