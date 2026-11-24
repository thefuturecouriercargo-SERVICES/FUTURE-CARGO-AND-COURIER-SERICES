import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dubaiDateStr } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";
import { emitGlobal } from "../lib/socket";
import { createHash } from "crypto";
import { BANK_CHECK_FROM_DATE, BANK_CHECK_FROM_TIME } from "../lib/bankCheck";

/**
 * Bank-payment receipts (planned 20 Nov 2026, built 22 Nov 2026).
 *  - Driver marks a CN Delivered with payment BANK → must add the receipt (photo or PDF). No typing.
 *  - The receipt is read in the background (amount, date, reference) — file kept 7 days.
 *  - Admin uploads the bank statement → credits are read and matched to the receipts:
 *    RECEIVED (CN marked bank-confirmed) or NOT RECEIVED YET.
 */
const router = Router();
router.use(authenticate);

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 7;
const FROM_TIME = BANK_CHECK_FROM_TIME;

type Part = { type: "image" | "document"; mime: string; base64: string } | { type: "text"; text: string };

async function readWithClaude<T>(part: Part, tool: { name: string; description: string; input_schema: unknown }, prompt: string, maxTokens = 800): Promise<T | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const content =
    part.type === "text"
      ? [{ type: "text", text: part.text }]
      : [{ type: part.type, source: { type: "base64", media_type: part.mime, data: part.base64 } }];
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: maxTokens,
        tools: [tool],
        // Forced tool_choice ("tool"/"any") is refused by newer models — ask for the tool in the prompt instead.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: [...content, { type: "text", text: `${prompt}\n\nGive your answer ONLY by calling the ${tool.name} tool.` }] }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: { type: string; name?: string; input?: T; text?: string }[] };
    if (!res.ok) {
      console.error("[bank] reader HTTP", res.status, JSON.stringify(body).slice(0, 300));
      return null;
    }
    const used = body.content?.find((c) => c.type === "tool_use" && c.name === tool.name)?.input;
    if (used) return used;
    // Fallback: the answer came back as plain JSON text.
    const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        /* ignore */
      }
    }
    console.error("[bank] reader gave no answer", text.slice(0, 200));
    return null;
  } catch (err) {
    console.error("[bank] reader failed", err);
    return null;
  }
}

function parseDataUrl(dataUrl: string, maxBytes: number) {
  const m = String(dataUrl ?? "").match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.+)$/);
  if (!m) throw new ApiError(400, "Receipt must be a photo or a PDF");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > maxBytes) throw new ApiError(413, "File is too large");
  return { mime: m[1], base64: m[2], buf };
}

// ---------- Receipt reading ----------

const RECEIPT_TOOL = {
  name: "bank_receipt",
  description: "Details printed on a bank transfer / payment receipt.",
  input_schema: {
    type: "object",
    properties: {
      amount: { type: ["number", "null"], description: "Amount transferred in AED. null if not clearly printed." },
      date: { type: ["string", "null"], description: "Transfer date as YYYY-MM-DD" },
      reference: { type: ["string", "null"], description: "Transaction / reference number" },
      from: { type: ["string", "null"], description: "Sender name or account" },
      note: { type: ["string", "null"], description: "Anything odd, e.g. 'failed', 'pending', 'not a receipt'" },
      fakeRisk: { type: "string", enum: ["low", "medium", "high"], description: "How likely the receipt is fake, edited or not a real completed transfer" },
      fakeSigns: { type: "array", items: { type: "string" }, description: "Short reasons, in capital letters, e.g. 'AMOUNT DIGITS IN A DIFFERENT FONT'. Empty when it looks genuine." },
    },
    required: ["amount", "date", "reference", "from", "note", "fakeRisk", "fakeSigns"],
  },
};

async function readReceipt(id: string) {
  const r = await prisma.bankReceipt.findUnique({ where: { id } });
  if (!r?.data) return;
  const out = await readWithClaude<{
    amount: number | null;
    date: string | null;
    reference: string | null;
    from: string | null;
    note: string | null;
    fakeRisk?: "low" | "medium" | "high";
    fakeSigns?: string[];
  }>(
    { type: r.mime === "application/pdf" ? "document" : "image", mime: r.mime, base64: Buffer.from(r.data).toString("base64") },
    RECEIPT_TOOL,
    "This is a bank transfer / payment receipt (UAE, AED) a customer sent to pay for a delivery. Read the amount transferred, the date, the reference number and the sender. If it is not a successful transfer receipt, say so in note. Use null for anything not clearly printed.\n\n" +
      "Also check carefully whether it could be FAKE or EDITED: digits or text in a different font, size, colour or alignment from the rest; blurred, smudged or pasted-looking patches around the amount, date or name; numbers that don't add up; a missing or odd-looking reference / transaction ID; layout that doesn't match a real UAE bank app or bank slip; status pending / failed / scheduled / draft; a beneficiary that isn't a courier company; a photo of a screen showing an editing app; a date in the future. Give fakeRisk low when it looks like a normal genuine receipt.\n\n" +
      "These are NORMAL in real UAE bank receipts and are NOT signs of a fake: masked names or account numbers (e.g. 'L*** C***', '****910001'); a short or cut-off beneficiary name (e.g. 'THE OPC', 'THE FUTURE CARGO AND'); wording like 'You have initiated a fund transfer' or 'Transfer details'; a plain PDF made by the bank app; a photo of a phone screen showing the bank app or email; no time shown, only a date; the beneficiary account 14140235920001 / IBAN AE190030014140235920001 (that is the courier company's own ADCB account — a match is a good sign). " +
      "Use fakeRisk high only for clear signs of editing or a failed/pending/draft transfer; use medium only when something specific looks wrong.",
    1200
  );
  await prisma.bankReceipt.update({
    where: { id },
    data: {
      readDone: true,
      readAmount: out?.amount ?? null,
      readDate: out?.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date) ? out.date : null,
      readRef: out?.reference ?? null,
      readFrom: out?.from ?? null,
      readNote: out ? out.note ?? null : "COULD NOT READ",
    },
  });
  await checkSuspect(id, out?.fakeRisk ?? null, out?.fakeSigns ?? []);
}

/** Flags a receipt that looks fake or reused, and rings the admin bell. */
async function checkSuspect(id: string, risk: "low" | "medium" | "high" | null, signs: string[]) {
  const r = await prisma.bankReceipt.findUnique({ where: { id } });
  if (!r) return;
  const why: string[] = [];
  if (risk === "high") why.push(...(signs.length ? signs : [`LOOKS ${risk === "high" ? "FAKE" : "DOUBTFUL"}`]).map((x) => x.toUpperCase()));
  if (r.hash) {
    const same = await prisma.bankReceipt.findFirst({ where: { hash: r.hash, id: { not: r.id }, orderId: { not: r.orderId } }, select: { cnNo: true } });
    if (same) why.push(`SAME FILE ALREADY USED FOR CN ${same.cnNo}`);
  }
  const ref = norm(r.readRef);
  if (ref.length >= 5) {
    const others = await prisma.bankReceipt.findMany({ where: { id: { not: r.id }, orderId: { not: r.orderId }, readRef: { not: null } }, select: { cnNo: true, readRef: true }, orderBy: { createdAt: "desc" }, take: 2000 });
    const dup = others.find((o) => norm(o.readRef) === ref);
    if (dup) why.push(`SAME REFERENCE ALREADY USED FOR CN ${dup.cnNo}`);
  }
  if (r.readAmount != null && r.readAmount > 0 && Math.abs(r.readAmount - r.amount) >= 0.5) why.push(`RECEIPT AED ${r.readAmount} BUT CN AED ${r.amount}`);
  if (r.readDate) {
    const up = dubaiDateStr(r.createdAt);
    const gap = (new Date(up).getTime() - new Date(r.readDate).getTime()) / DAY;
    if (gap < -1) why.push(`RECEIPT DATE ${r.readDate} IS IN THE FUTURE`);
    else if (gap > 3) why.push(`RECEIPT DATED ${r.readDate} — ${Math.round(gap)} DAYS BEFORE DELIVERY`);
  }
  if (r.readNote && /fail|pending|schedul|draft|not a/i.test(r.readNote)) why.push(r.readNote.toUpperCase());
  const unique = [...new Set(why)];
  const suspect = unique.length > 0;
  await prisma.bankReceipt.update({ where: { id }, data: { suspect, suspectWhy: suspect ? unique.join(" · ").slice(0, 600) : null } });
  if (suspect && !r.suspectOk) emitGlobal("bankreceipt:suspect", { cnNo: r.cnNo });
}

// ---------- Statement reading + matching ----------

type Credit = { date: string | null; amount: number; description: string };

const STATEMENT_TOOL = {
  name: "bank_statement",
  description: "Money-in lines (credits) on a bank statement.",
  input_schema: {
    type: "object",
    properties: {
      from: { type: ["string", "null"], description: "Statement period start YYYY-MM-DD" },
      to: { type: ["string", "null"], description: "Statement period end / last transaction date YYYY-MM-DD" },
      totalCredits: { type: ["number", "null"], description: "'Total no of credits' printed in the statement header, null if not printed" },
      totalCreditAmount: { type: ["number", "null"], description: "'Total Credit Amount' printed in the statement header, null if not printed" },
      credits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Credit amount in AED (money IN only)" },
            description: { type: "string", description: "Sender name (after B/O), bank reference no, customer reference no and payment details, joined with ' · '" },
          },
          required: ["date", "amount", "description"],
        },
      },
    },
    required: ["from", "to", "credits"],
  },
};

const norm = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Sender name words (3+ letters) from a receipt, e.g. "MUHAMMED ANSHAD S IBRAHIM" → MUHAMMED, ANSHAD, IBRAHIM. */
const nameWords = (s: string | null | undefined) =>
  String(s ?? "").toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3 && !["MR", "MRS", "MBTRF", "THE", "AND", "LLC"].includes(w));
const nameHits = (words: string[], text: string) => {
  const t = String(text ?? "").toUpperCase().replace(/[^A-Z]+/g, " ");
  return words.filter((w) => t.includes(w)).length;
};

/** Check every receipt that is not RECEIVED yet against all statements from the last 30 days. */
async function matchAll() {
  const statements = await prisma.bankStatement.findMany({ where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) }, state: { not: "FAILED" } }, orderBy: { createdAt: "asc" } });
  if (!statements.length) return { received: 0, notReceived: 0 };
  const credits: (Credit & { key: string })[] = [];
  let coveredTo = "";
  for (const s of statements) {
    (s.credits as unknown as Credit[]).forEach((c, i) => credits.push({ ...c, key: `${s.id}:${i}` }));
    const last = s.toDate ?? (s.credits as unknown as Credit[]).map((c) => c.date ?? "").sort().pop() ?? "";
    if (last > coveredTo) coveredTo = last;
  }
  // Credits already used by a received receipt can't pay a second one.
  const used = new Set((await prisma.bankReceipt.findMany({ where: { status: "RECEIVED", matchLine: { not: null } }, select: { matchLine: true } })).map((r) => r.matchLine!.split(" | ")[0]));
  const open = await prisma.bankReceipt.findMany({ where: { status: { not: "RECEIVED" }, createdAt: { gte: FROM_TIME } }, orderBy: { createdAt: "asc" } });

  let received = 0;
  let notReceived = 0;
  for (const r of open) {
    const want = r.readAmount != null && r.readAmount > 0 ? r.readAmount : r.amount;
    const day = r.readDate ?? dubaiDateStr(r.createdAt);
    const t = new Date(day).getTime();
    const ref = norm(r.readRef);
    const names = nameWords(r.readFrom);
    const cands = credits
      .filter((c) => !used.has(c.key) && Math.abs(c.amount - want) < 0.5)
      .filter((c) => !c.date || (new Date(c.date).getTime() >= t - 2 * DAY && new Date(c.date).getTime() <= t + 4 * DAY))
      .sort((a, b) => {
        const ra = ref.length >= 5 && norm(a.description).includes(ref) ? 0 : 1;
        const rb = ref.length >= 5 && norm(b.description).includes(ref) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        const na = nameHits(names, a.description);
        const nb = nameHits(names, b.description);
        if (na !== nb) return nb - na;
        return Math.abs(new Date(a.date ?? day).getTime() - t) - Math.abs(new Date(b.date ?? day).getTime() - t);
      });
    const hit = cands[0];
    if (hit) {
      used.add(hit.key);
      await prisma.bankReceipt.update({
        where: { id: r.id },
        data: { status: "RECEIVED", checkedAt: new Date(), matchLine: `${hit.key} | ${hit.date ?? ""} · AED ${hit.amount} · ${hit.description}`.slice(0, 400) },
      });
      await prisma.order.updateMany({ where: { id: r.orderId, payment: "BANK" }, data: { bankPaymentConfirmed: true } });
      await clearFlagIfPaid(r.id);
      received++;
    } else if (coveredTo && day <= coveredTo) {
      // The statement covers the receipt's day but the money isn't there.
      if (r.status !== "NOT_RECEIVED") await prisma.bankReceipt.update({ where: { id: r.id }, data: { status: "NOT_RECEIVED", checkedAt: new Date() } });
      notReceived++;
    }
  }
  return { received, notReceived };
}

/** Money found on the statement → the "looks fake" flag goes, unless the same file / reference was used for another CN. */
const REUSE = /SAME FILE|SAME REFERENCE/;
async function clearFlagIfPaid(id: string) {
  const r = await prisma.bankReceipt.findUnique({ where: { id }, select: { suspect: true, suspectWhy: true, status: true } });
  if (!r || r.status !== "RECEIVED" || !r.suspect) return;
  const keep = (r.suspectWhy ?? "").split(" · ").filter((x) => REUSE.test(x));
  await prisma.bankReceipt.update({ where: { id }, data: { suspect: keep.length > 0, suspectWhy: keep.length ? keep.join(" · ") : null } });
  emitGlobal("bankreceipt:suspect", {});
}

/** Remove receipt files older than 7 days (rows and results stay). */
export async function pruneBankReceipts() {
  await prisma.bankReceipt
    .updateMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * DAY) }, data: { not: null } }, data: { data: null } })
    .catch(() => undefined);
}
void pruneBankReceipts();

/** After a restart: statements left half-read are marked failed (upload again), and receipts that could not be read are read again. */
async function recoverOnStart() {
  const paid = await prisma.bankReceipt.findMany({ where: { status: "RECEIVED", suspect: true }, select: { id: true } }).catch(() => [] as { id: string }[]);
  for (const p of paid) await clearFlagIfPaid(p.id).catch(() => undefined);
  await prisma.bankStatement
    .updateMany({ where: { state: "READING" }, data: { state: "FAILED", result: "READING WAS INTERRUPTED — PLEASE UPLOAD THE STATEMENT AGAIN" } })
    .catch(() => undefined);
  const failed = await prisma.bankReceipt
    .findMany({ where: { data: { not: null }, createdAt: { gte: FROM_TIME }, OR: [{ readDone: false }, { readNote: "COULD NOT READ" }] }, select: { id: true } })
    .catch(() => [] as { id: string }[]);
  for (const f of failed) await readReceipt(f.id).catch(() => undefined);
  if (failed.length) await matchAll().catch(() => undefined);
}
setTimeout(() => void recoverOnStart(), 15_000);
setInterval(() => void pruneBankReceipts(), 6 * 60 * 60 * 1000);

// ---------- Routes ----------

/** Driver (or admin): add the receipt for a BANK CN. */
router.post(
  "/",
  requireRole("DRIVER", "SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { orderId, dataUrl } = z.object({ orderId: z.string().min(1), dataUrl: z.string().min(20) }).parse(req.body);
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { employee: { select: { id: true, name: true } } } });
    if (!order) throw new ApiError(404, "CN not found");
    if (req.user!.role === "DRIVER" && order.employeeId !== req.user!.sub) throw new ApiError(403, "This CN is not yours");
    const { mime, buf } = parseDataUrl(dataUrl, 4_500_000);
    // A new receipt replaces the earlier one for the same CN.
    await prisma.bankReceipt.deleteMany({ where: { orderId, status: { not: "RECEIVED" } } });
    const r = await prisma.bankReceipt.create({
      data: {
        orderId,
        cnNo: order.cnNo,
        employeeId: order.employeeId,
        employeeName: order.employee.name,
        amount: order.total,
        mime,
        data: buf,
        hash: createHash("sha256").update(buf).digest("hex"),
      },
      select: { id: true },
    });
    void readReceipt(r.id).then(() => matchAll()).catch(() => undefined);
    res.json({ ok: true, id: r.id });
  })
);

/** Does this CN already have a receipt? */
router.get(
  "/has/:orderId",
  asyncHandler(async (req, res) => {
    const r = await prisma.bankReceipt.findFirst({ where: { orderId: req.params.orderId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    res.json({ has: !!r, status: r?.status ?? null });
  })
);

/** View a receipt file (kept 7 days). */
router.get(
  "/:id/file",
  asyncHandler(async (req, res) => {
    const r = await prisma.bankReceipt.findUnique({ where: { id: req.params.id } });
    if (!r) throw new ApiError(404, "Receipt not found");
    if (req.user!.role === "DRIVER" && r.employeeId !== req.user!.sub) throw new ApiError(403, "Not yours");
    if (!r.data) throw new ApiError(410, "Receipt file removed after 7 days");
    res.setHeader("Content-Type", r.mime);
    res.setHeader("Content-Disposition", `inline; filename="receipt-${r.cnNo}.${r.mime === "application/pdf" ? "pdf" : "jpg"}"`);
    res.send(Buffer.from(r.data));
  })
);

/** Admin list: receipts + BANK deliveries (last 7 days) that have no receipt. */
router.get(
  "/",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const since = new Date(Math.max(Date.now() - 14 * DAY, FROM_TIME.getTime()));
    const receipts = await prisma.bankReceipt.findMany({
      where: { createdAt: { gte: FROM_TIME }, OR: [{ createdAt: { gte: since } }, { status: { not: "RECEIVED" } }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, orderId: true, cnNo: true, employeeName: true, amount: true, mime: true, readAmount: true, readDate: true, readRef: true,
        readFrom: true, readNote: true, readDone: true, status: true, matchLine: true, checkedAt: true, createdAt: true,
        suspect: true, suspectWhy: true, suspectOk: true,
      },
    });
    const withFile = new Set(
      (await prisma.bankReceipt.findMany({ where: { id: { in: receipts.map((r) => r.id) }, data: { not: null } }, select: { id: true } })).map((r) => r.id)
    );
    const orders = await prisma.order.findMany({
      where: { id: { in: receipts.map((r) => r.orderId) } },
      select: { id: true, vendor: { select: { name: true } }, booking: { select: { customerName: true } }, status: true, payment: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    // BANK deliveries in the last 7 days with no receipt at all.
    const bankDone = await prisma.order.findMany({
      where: { payment: "BANK", status: "DELIVERED", date: { gte: BANK_CHECK_FROM_DATE }, resolvedAt: { gte: new Date(Math.max(Date.now() - KEEP_DAYS * DAY, FROM_TIME.getTime())) } },
      select: { id: true, cnNo: true, total: true, resolvedAt: true, bankPaymentConfirmed: true, vendor: { select: { name: true } }, employee: { select: { name: true } }, booking: { select: { customerName: true } } },
      orderBy: { resolvedAt: "desc" },
    });
    const has = new Set((await prisma.bankReceipt.findMany({ where: { orderId: { in: bankDone.map((o) => o.id) } }, select: { orderId: true } })).map((r) => r.orderId));
    const missing = bankDone
      .filter((o) => !has.has(o.id))
      .map((o) => ({ orderId: o.id, cnNo: o.cnNo, total: o.total, on: o.resolvedAt?.toISOString() ?? null, driver: o.employee.name, vendor: o.vendor.name, customer: o.booking?.customerName ?? null, confirmed: o.bankPaymentConfirmed }));

    const lastStatement = await prisma.bankStatement.findFirst({ orderBy: { createdAt: "desc" }, select: { fileName: true, toDate: true, createdAt: true, credits: true, state: true, result: true } });
    res.json({
      receipts: receipts.map((r) => {
        const o = byId.get(r.orderId);
        return {
          ...r,
          matchLine: r.matchLine ? r.matchLine.split(" | ").slice(1).join(" | ") : null,
          createdAt: r.createdAt.toISOString(),
          checkedAt: r.checkedAt?.toISOString() ?? null,
          hasFile: withFile.has(r.id),
          vendor: o?.vendor.name ?? null,
          customer: o?.booking?.customerName ?? null,
          orderStatus: o?.status ?? null,
          payment: o?.payment ?? null,
        };
      }),
      missing,
      lastStatement: lastStatement
        ? { fileName: lastStatement.fileName, toDate: lastStatement.toDate, at: lastStatement.createdAt.toISOString(), credits: (lastStatement.credits as unknown as Credit[]).length, state: lastStatement.state, result: lastStatement.result }
        : null,
    });
  })
);

/** Admin uploads the bank statement (PDF / photo, or Excel/CSV sent as text). */
router.post(
  "/statement",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ fileName: z.string().max(200), dataUrl: z.string().optional(), text: z.string().max(400_000).optional() })
      .refine((b) => b.dataUrl || b.text, "Send a file")
      .parse(req.body);
    let part: Part;
    if (body.text) part = { type: "text", text: `Bank statement (${body.fileName}) as rows:\n${body.text}` };
    else {
      const f = parseDataUrl(body.dataUrl!, 9_000_000);
      part = { type: f.mime === "application/pdf" ? "document" : "image", mime: f.mime, base64: f.base64 };
    }
    if (!process.env.ANTHROPIC_API_KEY) throw new ApiError(503, "Statement reader is not set up (ANTHROPIC_API_KEY missing)");
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } });
    const st = await prisma.bankStatement.create({ data: { fileName: body.fileName, uploadedBy: user?.name ?? null, credits: [], state: "READING" } });
    const userId = req.user!.sub;
    // Reading a statement can take a minute — done in the background; the page polls GET /.
    void (async () => {
      try {
        type StOut = { from: string | null; to: string | null; totalCredits?: number | null; totalCreditAmount?: number | null; credits: Credit[] };
        const PROMPT =
          "This is a UAE bank statement (e.g. ADCB / Emirates Islamic layout) of a courier company. List EVERY credit (money IN) line with its date, amount in AED and the text that identifies it. " +
          "Each transaction row can wrap over several printed lines — keep one entry per Sr.No. The Credit Amount column holds the money in; the Debit column shows '-' for credits; Running Balance is NOT the amount. " +
          "Dates like 23-Nov-2026 become 2026-11-23. In description put the sender name (the name after B/O, or Remitter Info), the bank reference no, the customer reference no and any payment details (e.g. 'escalo perfume'), joined with ' · '. " +
          "Skip debits, balances and totals. Also give the statement period (Start Date / End Date) and the header's 'Total no of credits' and 'Total Credit Amount'.";
        const sumOf = (o: StOut) => Math.round((o.credits ?? []).filter((c) => typeof c.amount === "number" && c.amount > 0).reduce((a, c) => a + c.amount, 0) * 100) / 100;
        const agrees = (o: StOut) =>
          (o.totalCredits == null || (o.credits ?? []).filter((c) => c.amount > 0).length === o.totalCredits) &&
          (o.totalCreditAmount == null || Math.abs(sumOf(o) - o.totalCreditAmount) < 0.5);
        let out = await readWithClaude<StOut>(part, STATEMENT_TOOL, PROMPT, 16000);
        // The statement prints its own totals — if what was read doesn't add up, read it once more.
        if (out && !agrees(out)) {
          const again = await readWithClaude<StOut>(part, STATEMENT_TOOL, PROMPT + " Read very carefully: the number of credits and their sum must equal the header totals.", 16000);
          if (again && (agrees(again) || !out)) out = again;
        }
        const totalsNote =
          out && !agrees(out)
            ? ` · CHECK: READ ${(out.credits ?? []).length} CREDITS = AED ${sumOf(out)}, STATEMENT SAYS ${out.totalCredits ?? "?"} = AED ${out.totalCreditAmount ?? "?"}`
            : out && out.totalCreditAmount != null
              ? ` · TOTAL AED ${out.totalCreditAmount} MATCHES`
              : "";
        if (!out) {
          await prisma.bankStatement.update({ where: { id: st.id }, data: { state: "FAILED", result: "COULD NOT READ THE STATEMENT — TRY A CLEARER FILE" } });
          return;
        }
        const valid = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
        const credits = (out.credits ?? [])
          .filter((c) => typeof c.amount === "number" && c.amount > 0)
          .map((c) => ({ date: valid(c.date), amount: Math.round(c.amount * 100) / 100, description: String(c.description ?? "").slice(0, 200) }));
        await prisma.bankStatement.update({
          where: { id: st.id },
          data: { fromDate: valid(out.from), toDate: valid(out.to) ?? credits.map((c) => c.date ?? "").sort().pop() ?? null, credits },
        });
        // Make sure every receipt has been read before matching.
        const unread = await prisma.bankReceipt.findMany({
          where: { data: { not: null }, createdAt: { gte: FROM_TIME }, OR: [{ readDone: false }, { readNote: "COULD NOT READ" }] },
          select: { id: true },
        });
        for (const u of unread) await readReceipt(u.id);
        const result = await matchAll();
        await prisma.bankStatement.update({
          where: { id: st.id },
          data: { state: "DONE", result: `${credits.length} CREDITS READ · ${result.received} RECEIVED · ${result.notReceived} NOT RECEIVED YET${totalsNote}` },
        });
        await writeAuditLog({ userId, action: "BANK_STATEMENT", entity: "BankStatement", entityId: st.id, meta: { file: body.fileName, credits: credits.length, ...result } });
      } catch (err) {
        console.error("[bank] statement failed", err);
        await prisma.bankStatement.update({ where: { id: st.id }, data: { state: "FAILED", result: "SOMETHING WENT WRONG WHILE READING" } }).catch(() => undefined);
      }
    })();
    res.json({ ok: true, id: st.id });
  })
);

/** Bell: receipts that look fake / reused and nobody has checked yet. */
router.get(
  "/suspect",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const list = await prisma.bankReceipt.findMany({
      where: { suspect: true, suspectOk: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, cnNo: true, employeeName: true, amount: true, suspectWhy: true, createdAt: true },
      take: 100,
    });
    res.json({ list });
  })
);

/** Admin checked a flagged receipt and it is fine. */
router.post(
  "/:id/suspect-ok",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    await prisma.bankReceipt.update({ where: { id: req.params.id }, data: { suspectOk: true } });
    emitGlobal("bankreceipt:suspect", {});
    res.json({ ok: true });
  })
);

/** Admin: mark a receipt received / not received by hand (e.g. after checking the bank app). */
router.post(
  "/:id/mark",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(["RECEIVED", "NOT_RECEIVED", "WAITING"]) }).parse(req.body);
    const r = await prisma.bankReceipt.update({ where: { id: req.params.id }, data: { status, checkedAt: new Date(), matchLine: status === "RECEIVED" ? "manual | MARKED BY ADMIN" : null } });
    await prisma.order.updateMany({ where: { id: r.orderId, payment: "BANK" }, data: { bankPaymentConfirmed: status === "RECEIVED" } });
    if (status === "RECEIVED") await clearFlagIfPaid(r.id);
    res.json({ ok: true });
  })
);

export default router;
