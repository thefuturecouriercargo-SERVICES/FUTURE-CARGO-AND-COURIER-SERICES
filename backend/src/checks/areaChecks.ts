/**
 * AREA CHECKS: every area / emirate mistake reported so far, written down as a case.
 * Runs in `npm run build`. If ANY case fails, the build stops and Railway keeps the
 * current version live, so a fix for one address can't quietly break an older one.
 *
 * RULE (19 Nov): the emirate the vendor / client gave is NEVER changed by the app.
 * When the address points to another emirate, only a CHECK warning is shown (`warn`).
 * Only a blank / OTHER emirate may be filled in from the address.
 *
 * Every new wrong-area report: add its address here first, then fix the rules.
 * Run on its own with: npx tsx src/checks/areaChecks.ts
 */
import { detectArea, emirateWarning } from "../lib/areas";
import { correctEmirate } from "../lib/deliveryCharge";

type Case = {
  address: string;
  /** Emirate picked on the form / website. */
  picked: string;
  /** Area the driver's By Area list and the label must show. */
  area?: string;
  /** Emirate the parcel must be saved and printed under. */
  emirate?: string;
  /** CHECK warning expected: the emirate the address looks like (null = no warning). */
  warn?: string | null;
  /** Area it must NEVER show (for cases where the exact name may change). */
  notArea?: string;
  why: string;
};

const CASES: Case[] = [
  // Sharjah
  { address: "RAMEZ MALL NEAR CRICKET STADIUM SHARJAH, AL ANSARI EXCHANGE INSIDE, SHARJAH, SHARJAH", picked: "SHARJAH", area: "INDUSTRIAL AREA 5", emirate: "SHARJAH", why: "CN 21774 shown under Al Nahda (DXB)" },
  { address: "near cricket stadium", picked: "SHARJAH", notArea: "AL NAHDA (DXB)", why: "'stadium' read as Al Nahda Dubai" },
  { address: "Saif Zone, Sharjah", picked: "SHARJAH", area: "SAIF ZONE", emirate: "SHARJAH", why: "Saif Zone shown as Al Nahda" },
  { address: "Al Nahda Sharjah, near Nahda park", picked: "SHARJAH", area: "AL NAHDA (SHJ)", emirate: "SHARJAH", why: "Al Nahda: Sharjah written decides" },
  { address: "Muwailah commercial", picked: "SHARJAH", area: "MUWAILEH", emirate: "SHARJAH", why: "spelling" },
  { address: "Rolah, near bank street", picked: "SHARJAH", area: "ROLLA", emirate: "SHARJAH", why: "spelling" },
  { address: "Al Taawon, Sharjah", picked: "SHARJAH", area: "AL TAAWUN", emirate: "SHARJAH", why: "spelling" },
  { address: "Industrial Area 13, Sharjah", picked: "SHARJAH", area: "INDUSTRIAL AREA 13", emirate: "SHARJAH", why: "numbered industrial area" },
  { address: "Beauty salon, Al Majaz 2", picked: "SHARJAH", notArea: "MAYSALOON", why: "salon is not Maysaloon" },
  { address: "Thumbay Hospital", picked: "SHARJAH", area: "MUWAILEH", emirate: "SHARJAH", why: "Thumbay hospital = Muwaileh" },

  // Dubai
  { address: "Al Nahda 2, near stadium", picked: "DUBAI", area: "AL NAHDA (DXB)", emirate: "DUBAI", why: "Al Nahda 1/2 are Dubai" },
  { address: "DAFZA, Dubai Airport Free Zone", picked: "DUBAI", area: "AL QUSAIS", emirate: "DUBAI", why: "DAFZA is not Jebel Ali" },
  { address: "Silicon Oasis, building 3", picked: "SHARJAH", emirate: "SHARJAH", warn: "DUBAI", why: "Silicon Oasis shown as Sharjah (18 Nov)" },
  { address: "Al Warqa 1, villa 20", picked: "SHARJAH", emirate: "SHARJAH", warn: "DUBAI", why: "Al Warqa is Dubai" },
  { address: "Jumeirah 2, Umm Suqeim", picked: "SHARJAH", emirate: "SHARJAH", warn: "DUBAI", why: "Jumeirah / Umm Suqeim are Dubai" },
  { address: "Al Qusais Industrial Area 2", picked: "SHARJAH", area: "AL QUSAIS", emirate: "SHARJAH", warn: "DUBAI", why: "Qusais industrial is Dubai" },
  { address: "Jabel Ali industrial", picked: "DUBAI", area: "JEBEL ALI", emirate: "DUBAI", why: "Jabel Ali spelling" },
  { address: "Ra's Al Khor, Dubai", picked: "UMM AL QUWAIN", emirate: "UMM AL QUWAIN", warn: "DUBAI", why: "Ras Al Khor saved as UAQ" },
  { address: "All Quiz 3", picked: "DUBAI", area: "AL QUOZ", emirate: "DUBAI", why: "spelling" },
  { address: "Qusias 2", picked: "DUBAI", area: "AL QUSAIS", emirate: "DUBAI", why: "spelling" },
  { address: "Cup Dubai cafeteria", picked: "DUBAI", notArea: "BUR DUBAI", why: "'Cup Dubai' is not Bur Dubai" },

  // Ajman
  { address: "Corniche", picked: "AJMAN", area: "AJMAN DOWNTOWN", emirate: "AJMAN", why: "ORD10035 Ajman Corniche moved to Abu Dhabi" },
  { address: "Corniche, Ajman", picked: "AJMAN", area: "AJMAN DOWNTOWN", emirate: "AJMAN", why: "ORD10035" },
  { address: "Ind. Area 1", picked: "AJMAN", area: "AJMAN INDUSTRIAL", emirate: "AJMAN", why: "EW slip Ajman Ind. Area 1 labelled Sharjah" },

  // Abu Dhabi
  { address: "Corniche, Abu Dhabi", picked: "ABUDHABI", area: "CORNICHE", emirate: "ABUDHABI", why: "Abu Dhabi Corniche still works" },
  { address: "Wathba Al Nahda", picked: "ABUDHABI", emirate: "ABUDHABI", notArea: "AL NAHDA (SHJ)", why: "Wathba Al Nahda is Abu Dhabi" },
  { address: "Baniyas, Al Nahda district", picked: "SHARJAH", emirate: "SHARJAH", warn: "ABUDHABI", why: "Baniyas + Al Nahda saved as Sharjah" },
  { address: "Mussafha M-24", picked: "DUBAI", emirate: "DUBAI", warn: "ABUDHABI", why: "Mussafah spelling saved as Dubai" },
  { address: "Sabiya 12", picked: "ABUDHABI", area: "SHABIYA 12", emirate: "ABUDHABI", why: "spelling" },
  { address: "Ruwais housing", picked: "ABUDHABI", area: "RUWAIS", why: "Western Region" },

  // Outside emirates
  { address: "Ummul Kuvain, near Lulu", picked: "ABUDHABI", emirate: "ABUDHABI", warn: "UMM AL QUWAIN", why: "Ummul Kuvain saved as Abu Dhabi" },
  { address: "Umin al quin", picked: "DUBAI", emirate: "DUBAI", warn: "UMM AL QUWAIN", why: "spelling" },
  { address: "EUROTECH INTERNATIONAL FZ LLC RAKEZ, BC-2, OFFICE #123 BUSINESS PARK, RAS AL KHAIMA", picked: "RAS AL KHAIMAH", emirate: "RAS AL KHAIMAH", why: "RAK label" },

  // Given emirate stays; matching address → no warning
  { address: "RAMEZ MALL NEAR CRICKET STADIUM SHARJAH", picked: "SHARJAH", emirate: "SHARJAH", warn: null, why: "no false CHECK" },
  { address: "Corniche", picked: "AJMAN", emirate: "AJMAN", warn: null, why: "ORD10035 no CHECK" },
  { address: "Al Barsha 1, Dubai", picked: "DUBAI", emirate: "DUBAI", warn: null, why: "no false CHECK" },
  { address: "Ras Al Khaimah, Al Nakheel", picked: "RAS AL KHAIMAH", emirate: "RAS AL KHAIMAH", warn: null, why: "no false CHECK" },
  // Nothing given → app may fill it in
  { address: "Deira, near Gold Souk", picked: "OTHER", emirate: "DUBAI", why: "OTHER filled from area" },
  { address: "Ummul Kuvain", picked: "", emirate: "UMM AL QUWAIN", why: "blank filled from address" },
];

let failed = 0;
for (const c of CASES) {
  const emirate = correctEmirate(c.picked, c.address);
  const area = detectArea(c.address, emirate);
  const problems: string[] = [];
  if (c.area && area !== c.area) problems.push(`area ${area} (should be ${c.area})`);
  if (c.notArea && area === c.notArea) problems.push(`area ${area} (must not be)`);
  if (c.emirate && emirate !== c.emirate) problems.push(`saved emirate ${emirate} (should be ${c.emirate})`);
  // Given emirate must never be changed by the app.
  if (c.picked && c.picked !== "OTHER" && emirate !== c.picked) problems.push(`given emirate ${c.picked} was changed to ${emirate}`);
  if (c.warn !== undefined) {
    const w = emirateWarning(emirate, c.address);
    if (w !== c.warn) problems.push(`CHECK warning ${w ?? "none"} (should be ${c.warn ?? "none"})`);
  }
  if (problems.length) {
    failed++;
    console.error(`✗ "${c.address}" [picked ${c.picked}] → ${problems.join(", ")} — ${c.why}`);
  }
}
if (failed) {
  console.error(`\nAREA CHECKS FAILED: ${failed} of ${CASES.length} known addresses are wrong again. Not deploying.`);
  process.exit(1);
}
console.log(`Area checks passed: ${CASES.length} known addresses correct.`);
