import { prisma } from "../lib/prisma";
import { hashPassword } from "../utils/password";
import { writeAuditLog } from "./audit.service";

/** Standard vendor portal login: name in capitals (letters/digits only), password NAME321. */
export function defaultVendorLogin(name: string) {
  const username = name.toUpperCase().replace(/[^A-Z0-9]/g, "") || "VENDOR";
  return { username, password: `${username}321` };
}

/** Give every vendor the standard login. Returns what each vendor now uses. */
export async function resetAllVendorLogins(userId?: string) {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const taken = new Set<string>();
  const result: { name: string; username: string; password: string }[] = [];
  // Clear first so renames can't clash with an old username.
  await prisma.vendor.updateMany({ data: { username: null } });
  for (const v of vendors) {
    const base = defaultVendorLogin(v.name);
    let username = base.username;
    for (let n = 2; taken.has(username); n++) username = `${base.username}${n}`;
    taken.add(username);
    const password = `${username}321`;
    await prisma.vendor.update({ where: { id: v.id }, data: { username, passwordHash: await hashPassword(password) } });
    result.push({ name: v.name, username, password });
  }
  await writeAuditLog({ userId, action: "VENDOR_LOGIN_RESET", entity: "Vendor", meta: { count: result.length } });
  return result;
}

/** One-time switch to the standard logins (runs once after deploy, then never again). */
export async function runVendorLoginResetOnce() {
  const MARK = "VENDOR_LOGIN_RESET_2026_10_19";
  try {
    const done = await prisma.auditLog.findFirst({ where: { action: MARK }, select: { id: true } });
    if (done) return;
    const r = await resetAllVendorLogins();
    await prisma.auditLog.create({ data: { action: MARK, entity: "Vendor", meta: { count: r.length } } });
    console.log(`[vendors] standard logins set for ${r.length} vendors`);
  } catch (err) {
    console.error("[vendors] login reset failed:", err);
  }
}
