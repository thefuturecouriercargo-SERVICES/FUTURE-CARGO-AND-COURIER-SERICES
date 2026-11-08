import webpush from "web-push";

import { prisma } from "../lib/prisma";
import { dayRange } from "../utils/dates";
import { normalizeEmirate, prayerTimesFor, type PrayerName } from "../lib/prayerTimes";

/**
 * Azan push notifications: at each prayer time every driver with a subscribed
 * phone gets a notification, even when the driver portal is closed. Tapping it
 * opens the portal with the Malayalam reminder popup and the Azan.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:thefuturecouriercargo@gmail.com";

export const pushConfigured = () => Boolean(PUBLIC_KEY && PRIVATE_KEY);
export const vapidPublicKey = () => PUBLIC_KEY;

if (pushConfigured()) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);

/** Emirate where the driver has most consignments today (today's + older still-pending), default Dubai. */
export async function driverEmirate(userId: string): Promise<{ emirate: string; counts: Record<string, number> }> {
  const { start } = dayRange();
  const orders = await prisma.order.findMany({
    where: {
      employeeId: userId,
      OR: [{ date: start }, { status: { in: ["PENDING", "TRANSFER"] }, date: { lt: start } }],
    },
    select: { emirate: true, booking: { select: { emirate: true } } },
  });
  const counts: Record<string, number> = {};
  for (const o of orders as { emirate: string; booking: { emirate: string | null } | null }[]) {
    const em = normalizeEmirate(o.booking?.emirate) ?? normalizeEmirate(o.emirate);
    if (em) counts[em] = (counts[em] ?? 0) + 1;
  }
  const emirate = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "DUBAI";
  return { emirate, counts };
}

const NAMES_ML: Record<PrayerName, string> = {
  fajr: "സുബ്ഹി",
  dhuhr: "ളുഹർ",
  asr: "അസർ",
  maghrib: "മഗ്‌രിബ്",
  isha: "ഇശാ",
};

const SHORT_LINES = [
  "റൂട്ട് തീരില്ല, പക്ഷേ ആയുസ്സ് തീരും. വണ്ടി ഒതുക്കൂ.",
  "5 മിനിറ്റ് നിസ്കാരം, ബറക്കത്ത് കൂടുകയേ ഉള്ളൂ.",
  "ആദ്യം റബ്ബിനോട്, പിന്നെ ഡെലിവറി.",
  "ഖിയാമത്ത് നാളിൽ ആദ്യം ചോദിക്കുന്നത് നമസ്കാരത്തെക്കുറിച്ചാണ്.",
  "നിസ്കാരം ഖളാ ആക്കരുത്.",
];

// Sent-already memory: "YYYY-MM-DD:prayer:userId". Cleared when the day changes.
const sent = new Set<string>();
let sentDay = "";
// A notification is only sent within this many ms after the prayer time (covers restarts / slow ticks).
const SEND_WINDOW_MS = 3 * 60_000;

async function tick() {
  const subs = await prisma.pushSubscription.findMany({
    where: { user: { role: "DRIVER", active: true } },
  });
  if (!subs.length) return;

  const byUser = new Map<string, typeof subs>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  const now = Date.now();
  for (const [userId, userSubs] of byUser) {
    const { emirate } = await driverEmirate(userId);
    const t = prayerTimesFor(emirate);
    if (t.date !== sentDay) {
      sent.clear();
      sentDay = t.date;
    }
    const due = t.prayers.find((p) => {
      const at = new Date(p.at).getTime();
      return now >= at && now - at < SEND_WINDOW_MS && !sent.has(`${t.date}:${p.name}:${userId}`);
    });
    if (!due) continue;
    sent.add(`${t.date}:${due.name}:${userId}`);

    const time = new Date(due.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });
    const line = SHORT_LINES[Math.floor(now / 60_000) % SHORT_LINES.length];
    const payload = JSON.stringify({
      title: `🕌 ${NAMES_ML[due.name]} നിസ്കാര സമയം · ${time}`,
      body: `അല്ലാഹു അക്ബർ, അല്ലാഹു അക്ബർ\n${line}`,
      url: `/driver?prayer=${due.name}`,
      tag: `azan-${t.date}-${due.name}`,
    });

    for (const s of userSubs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 5 * 60, urgency: "high" } // a notification older than 5 min is dropped, never shown late
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // 404/410 = the phone unsubscribed or the browser data was cleared — forget it.
        if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else console.error("[azan-push] send failed", code ?? err);
      }
    }
  }
}

export function startAzanPushScheduler() {
  if (!pushConfigured()) {
    console.log("[azan-push] VAPID keys not set — Azan push notifications off");
    return;
  }
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    tick()
      .catch((err) => console.error("[azan-push] tick failed", err))
      .finally(() => {
        running = false;
      });
  }, 30_000);
  console.log("[azan-push] scheduler started");
}
