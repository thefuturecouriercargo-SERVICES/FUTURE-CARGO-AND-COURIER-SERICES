import crypto from "crypto";
import { env } from "../config/env";

/** Reversible encryption (AES-256-GCM) so admin can view staff passwords. Key derived from JWT_SECRET. */
const key = () => crypto.createHash("sha256").update(`${env.jwtSecret}:staff-password`).digest();

export function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
