import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, ApiError } from "../utils/asyncHandler";
import { authenticate, requireRole } from "../middleware/auth";
import { dubaiDateStr } from "../utils/dates";
import { writeAuditLog } from "../services/audit.service";

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
        tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content: [...content, { type: "text", text: prompt }] }],
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { content?: { type: string; name?: string; input?: T }[] };
    if (!res.ok) {
      console.error("[bank] reader HTTP", res.status, JSON.stringify(body).slice(0, 300));
      return null;
    }
    return body.content?.find((c) => c.type === "tool_use" && c.name === tool.name)?.input ?? null;
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
    },
    required: ["amount", "date", "reference", "from", "note"],
  },
};

async function readReceipt(id: string) {
  const r = await prisma.bankReceipt.findUnique({ where: { id } });
  if (!r?.data) return;
  const out = await readWithClaude<{ amount: number | null; date: string | null; reference: string | null; from: string | null; note: string | null }>(
    { type: r.mime === "application/pdf" ? "document" : "image", mime: r.mime, base64: Buffer.from(r.data).toString("base64") },
    RECEIPT_TOOL,
    "This is a bank transfer / payment receipt (UAE, AED) a customer sent to pay for a delivery. Read the amount transferred, the date, the reference number and the sender. If it is not a successful transfer receipt, say so in note. Use null for anything not clearly printed."
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
      credits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: ["string", "null"], description: "YYYY-MM-DD" },
            amount: { type: "number", description: "Credit amount in AED (money IN only)" },
            description: { type: "string", description: "Narration / sender / reference text as printed" },
          },
          required: ["date", "amount", "description"],
        },
      },
    },
    required: ["from", "to", "credits"],
  },
};

const norm = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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
  const open = await prisma.bankReceipt.findMany({ where: { status: { not: "RECEIVED" } }, orderBy: { createdAt: "asc" } });

  let received = 0;
  let notReceived = 0;
  for (const r of open) {
    const want = r.readAmount != null && r.readAmount > 0 ? r.readAmount : r.amount;
    const day = r.readDate ?? dubaiDateStr(r.createdAt);
    const t = new Date(day).getTime();
    const ref = norm(r.readRef);
    const cands = credits
      .filter((c) => !used.has(c.key) && Math.abs(c.amount - want) < 0.5)
      .filter((c) => !c.date || (new Date(c.date).getTime() >= t - 2 * DAY && new Date(c.date).getTime() <= t + 4 * DAY))
      .sort((a, b) => {
        const ra = ref.length >= 5 && norm(a.description).includes(ref) ? 0 : 1;
        const rb = ref.length >= 5 && norm(b.description).includes(ref) ? 0 : 1;
        if (ra !== rb) return ra - rb;
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
      received++;
    } else if (coveredTo && day <= coveredTo) {
      // The statement covers the receipt's day but the money isn't there.
      if (r.status !== "NOT_RECEIVED") await prisma.bankReceipt.update({ where: { id: r.id }, data: { status: "NOT_RECEIVED", checkedAt: new Date() } });
      notReceived++;
    }
  }
  return { received, notReceived };
}

/** Remove receipt files older than 7 days (rows and results stay). */
export async function pruneBankReceipts() {
  await prisma.bankReceipt
    .updateMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * DAY) }, data: { not: null } }, data: { data: null } })
    .catch(() => undefined);
}
void pruneBankReceipts();
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
      data: { orderId, cnNo: order.cnNo, employeeId: order.employeeId, employeeName: order.employee.name, amount: order.total, mime, data: buf },
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
    const since = new Date(Date.now() - 14 * DAY);
    const receipts = await prisma.bankReceipt.findMany({
      where: { OR: [{ createdAt: { gte: since } }, { status: { not: "RECEIVED" } }] },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, orderId: true, cnNo: true, employeeName: true, amount: true, mime: true, readAmount: true, readDate: true, readRef: true,
        readFrom: true, readNote: true, readDone: true, status: true, matchLine: true, checkedAt: true, createdAt: true,
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
      where: { payment: "BANK", status: "DELIVERED", resolvedAt: { gte: new Date(Date.now() - KEEP_DAYS * DAY) } },
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
        const out = await readWithClaude<{ from: string | null; to: string | null; credits: Credit[] }>(
          part,
          STATEMENT_TOOL,
          "This is a UAE bank statement of a courier company. List EVERY credit (money IN) line with its date, amount in AED and the narration/sender/reference text exactly as printed. Skip debits (money out), balances and totals. Also give the statement period.",
          16000
        );
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
        const unread = await prisma.bankReceipt.findMany({ where: { readDone: false, data: { not: null } }, select: { id: true } });
        for (const u of unread) await readReceipt(u.id);
        const result = await matchAll();
        await prisma.bankStatement.update({
          where: { id: st.id },
          data: { state: "DONE", result: `${credits.length} CREDITS READ · ${result.received} RECEIVED · ${result.notReceived} NOT RECEIVED YET` },
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

/** Admin: mark a receipt received / not received by hand (e.g. after checking the bank app). */
router.post(
  "/:id/mark",
  requireRole("SUPER_ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(["RECEIVED", "NOT_RECEIVED", "WAITING"]) }).parse(req.body);
    const r = await prisma.bankReceipt.update({ where: { id: req.params.id }, data: { status, checkedAt: new Date(), matchLine: status === "RECEIVED" ? "manual | MARKED BY ADMIN" : null } });
    await prisma.order.updateMany({ where: { id: r.orderId, payment: "BANK" }, data: { bankPaymentConfirmed: status === "RECEIVED" } });
    res.json({ ok: true });
  })
);

export default router;
