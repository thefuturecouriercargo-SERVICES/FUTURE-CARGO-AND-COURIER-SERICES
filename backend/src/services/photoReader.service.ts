import { prisma } from "../lib/prisma";
import { ApiError } from "../utils/asyncHandler";

/**
 * Reads handwritten / photographed order slips with Claude (Anthropic API).
 * Needs ANTHROPIC_API_KEY in the environment. ANTHROPIC_MODEL overrides the model.
 */

const EMIRATES = ["DUBAI", "SHARJAH", "ABUDHABI", "AL AIN", "AJMAN", "RAS AL KHAIMAH", "FUJAIRAH", "UMM AL QUWAIN", "OTHER"] as const;

export interface ReadOrder {
  vendorRef: string | null;
  customerName: string | null;
  agent: string | null;
  customerPhone: string | null;
  address: string | null;
  emirate: string | null;
  items: string | null;
  codAmount: number | null;
  notes: string | null;
  unclear: string[];
}

export function photoReaderConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const PROMPT = `You are reading a photo of an order slip for a courier company in the UAE.
Vendors write these by hand (or send a screenshot/printed bill). Extract every order on it.

How these slips usually look:
- A number at the top (often underlined), e.g. "1211" = the vendor's own bill/order number → vendorRef.
- Emirate written as a word or code: DXB/Dubai → DUBAI, SHJ/Sharjah → SHARJAH, AD/AUH/Abu Dhabi → ABUDHABI (vendors often write just "AD"), AIN/Al Ain → AL AIN, AJM/Ajman → AJMAN, RAK → RAS AL KHAIMAH, FUJ/Fujairah → FUJAIRAH, UAQ → UMM AL QUWAIN. Areas imply the emirate (Business Bay, Deira, JLT, Marina, Al Barsha… → DUBAI; Al Nahda/Muwaileh/Al Majaz → SHARJAH unless the slip says Dubai; Mussafah/Khalifa City → ABUDHABI).
- Area / building / street → address (keep the words as written, fix obvious spelling like "Busness bay" → "Business Bay").
- A UAE phone number, usually 05X XXX XXXX. Write it as "05X XXX XXXX". If a digit is unreadable, give your best reading and add "phone" to unclear.
- Quantity like "1pce", "2 pcs", "1 pc" and any product name → items, written like "1 × Perfume" or "1 piece" when no product is named.
- Shoes are common: "1 shoe", "2 shoes", "1 pair", "1 sh" → items "1 × Shoe" / "2 × Shoe". Read the number before it carefully.
- An amount like "55/-", "AED 55", "55 dhs" → codAmount (whole number). "Paid" / "prepaid" → 0.
- Words like "Top Urgent", "Urgent", "Call before", "Evening" → notes (e.g. "TOP URGENT").
- Customer names are often NOT written — then customerName is null. Do not invent one.
- A short name or initials written on its own (e.g. "Haira", "K", "KD", "Sam") is usually the vendor's AGENT / salesman, not the customer → put it in "agent", and leave customerName null unless the slip clearly labels a customer name.
- The bill number (vendorRef) is important — always look for it and read every digit.
- Ignore single stray letters or ticks in the corners (e.g. a lone "N") — they are internal marks, not data.
Never guess data that is not on the slip; use null. List any field you were unsure about in "unclear".`;

const TOOL = {
  name: "record_orders",
  description: "Record the orders read from the slip photo.",
  input_schema: {
    type: "object",
    properties: {
      orders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            vendorRef: { type: ["string", "null"], description: "Vendor's bill / order number" },
            customerName: { type: ["string", "null"] },
            agent: { type: ["string", "null"], description: "Agent / salesman name or initials written on the slip (e.g. K, KD, Haira)" },
            customerPhone: { type: ["string", "null"] },
            address: { type: ["string", "null"] },
            emirate: { type: ["string", "null"], enum: [...EMIRATES, null] },
            items: { type: ["string", "null"] },
            codAmount: { type: ["integer", "null"] },
            notes: { type: ["string", "null"] },
            unclear: { type: "array", items: { type: "string", enum: ["vendorRef", "customerName", "customerPhone", "address", "emirate", "items", "codAmount", "notes"] } },
          },
          required: ["vendorRef", "customerName", "customerPhone", "address", "emirate", "items", "codAmount", "notes", "unclear"],
        },
      },
    },
    required: ["orders"],
  },
};

/** imageBase64: raw base64 (no data: prefix). */
export async function readOrderPhoto(imageBase64: string, mime = "image/jpeg"): Promise<ReadOrder[]> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ApiError(503, "Photo reader is not set up yet — add ANTHROPIC_API_KEY in Railway");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL(),
      max_tokens: 1500,
      tools: [TOOL],
      // Some models don't allow a forced tool choice, so ask for it in the prompt instead.
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: imageBase64 } },
            { type: "text", text: `${PROMPT}\n\nReply only by calling the ${TOOL.name} tool.` },
          ],
        },
      ],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; text?: string; input?: { orders?: ReadOrder[] } }[];
    error?: { type?: string; message?: string };
  };
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new ApiError(502, "Photo reader key is wrong or revoked (Anthropic 401)");
    if (/credit|balance|billing/i.test(msg)) throw new ApiError(502, "Photo reader has no credit left — top up at console.anthropic.com");
    if (res.status === 429 || res.status === 529) throw new ApiError(503, "Photo reader is busy — try again in a moment");
    throw new ApiError(502, `Photo reader error: ${msg}`);
  }
  const tool = body.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
  let orders = tool?.input?.orders ?? [];
  if (!tool) {
    // Fallback: the model answered with JSON text instead of the tool.
    const text = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
    const json = text.match(/\{[\s\S]*\}/);
    try {
      const parsed = json ? JSON.parse(json[0]) : null;
      orders = Array.isArray(parsed?.orders) ? parsed.orders : [];
    } catch {
      orders = [];
    }
  }
  return orders.map((o) => ({
    vendorRef: o.vendorRef ? String(o.vendorRef).trim() : null,
    customerName: o.customerName?.trim() || null,
    agent: o.agent ? String(o.agent).trim() || null : null,
    customerPhone: o.customerPhone?.trim() || null,
    address: o.address?.trim() || null,
    emirate: o.emirate && (EMIRATES as readonly string[]).includes(o.emirate) ? o.emirate : null,
    items: o.items?.trim() || null,
    codAmount: typeof o.codAmount === "number" && Number.isFinite(o.codAmount) ? Math.max(0, Math.round(o.codAmount)) : null,
    notes: o.notes?.trim() || null,
    unclear: Array.isArray(o.unclear) ? o.unclear : [],
  }));
}

const MAX_PHOTO_BYTES = 600 * 1024;

/** Store the small copy of the slip so it can be attached to the booking on save. */
export async function storeSlipPhoto(vendorId: string, thumbDataUrl: string | undefined): Promise<string | null> {
  if (!thumbDataUrl) return null;
  const m = thumbDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_PHOTO_BYTES) return null;
  const photo = await prisma.bookingPhoto.create({ data: { vendorId, mime: m[1], data: buf }, select: { id: true } });
  return photo.id;
}

/** Attach a stored slip photo to a newly saved booking (same vendor, not yet used). */
export async function attachSlipPhoto(photoId: unknown, bookingId: string, vendorId: string) {
  if (typeof photoId !== "string" || !photoId) return;
  const updated = await prisma.bookingPhoto.updateMany({ where: { id: photoId, vendorId, bookingId: null }, data: { bookingId } });
  if (updated.count) await prisma.booking.update({ where: { id: bookingId }, data: { hasPhoto: true } });
}

export async function getBookingPhoto(bookingId: string, vendorId?: string) {
  const photo = await prisma.bookingPhoto.findUnique({ where: { bookingId } });
  if (!photo || (vendorId && photo.vendorId !== vendorId)) throw new ApiError(404, "No photo for this order");
  return photo;
}

/** Slip photos are only needed briefly: unused uploads go after 1 day, saved ones after 2 days. */
export async function prunePhotos() {
  const day = 24 * 60 * 60 * 1000;
  await prisma.bookingPhoto.deleteMany({ where: { bookingId: null, createdAt: { lt: new Date(Date.now() - 1 * day) } } });
  const old = await prisma.bookingPhoto.findMany({ where: { createdAt: { lt: new Date(Date.now() - 2 * day) } }, select: { id: true, bookingId: true } });
  if (old.length) {
    await prisma.booking.updateMany({ where: { id: { in: old.map((o) => o.bookingId).filter(Boolean) as string[] } }, data: { hasPhoto: false } });
    await prisma.bookingPhoto.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }
}

export function startPhotoPruneScheduler() {
  const run = () => prunePhotos().catch((err) => console.error("[photos] prune failed:", err));
  setTimeout(run, 60 * 1000);
  setInterval(run, 60 * 60 * 1000);
}
