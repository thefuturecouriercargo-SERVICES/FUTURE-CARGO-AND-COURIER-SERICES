/**
 * Picks the delivery area (neighbourhood) out of a free-text UAE address, so a
 * driver's parcels can be grouped and sorted area by area.
 * First match wins, so more specific names come before broader ones.
 */

type AreaRule = [RegExp, string];

const DUBAI: AreaRule[] = [
  [/\bbusiness\s*bay\b/i, "BUSINESS BAY"],
  [/\bdubai\s*hills?\b|\bpark\s*lane\b/i, "DUBAI HILLS"],
  [/\bdown\s*town\b|\bburj\s*khalifa\b|\bdubai\s*mall\b/i, "DOWNTOWN"],
  [/\bjlt\b|\bjumeirah\s*lake/i, "JLT"],
  [/\bjbr\b|\bjumeirah\s*beach\s*res/i, "JBR"],
  [/\bmarina\b/i, "DUBAI MARINA"],
  [/\bjvc\b|\bjumeirah\s*village\s*c/i, "JVC"],
  [/\bjvt\b|\bjumeirah\s*village\s*t/i, "JVT"],
  [/\bbarsha\s*heights?\b|\btecom\b/i, "BARSHA HEIGHTS"],
  [/\bal\s*barsha\b|\bbarsha\b/i, "AL BARSHA"],
  [/\bal\s*quoz\b|\bquoz\b/i, "AL QUOZ"],
  [/\bdiscovery\s*garden/i, "DISCOVERY GARDENS"],
  [/\bal\s*furjan\b|\bfurjan\b/i, "AL FURJAN"],
  [/\bjebel\s*ali\b|\bjafza\b/i, "JEBEL ALI"],
  [/\bdip\b|\binvestment\s*park\b/i, "DIP"],
  [/\bsports\s*city\b/i, "SPORTS CITY"],
  [/\bmotor\s*city\b/i, "MOTOR CITY"],
  [/\barabian\s*ranches?\b/i, "ARABIAN RANCHES"],
  [/\bdamac\s*hills\b|\bakoya\s*oxygen\b/i, "DAMAC HILLS"],
  [/\bdubai\s*land\b|\bdubailand\b/i, "DUBAILAND"],
  [/\bsilicon\s*oasis\b|\bdso\b/i, "SILICON OASIS"],
  [/\binternational\s*city\b/i, "INTERNATIONAL CITY"],
  [/\bwarsan\b/i, "WARSAN"],
  [/\bal\s*warqa\b|\bwarqa\b/i, "AL WARQA"],
  [/\bmirdif\b|\bmirdiff\b/i, "MIRDIF"],
  [/\bal\s*mizhar\b|\bmizhar\b/i, "AL MIZHAR"],
  [/\bal\s*khawaneej\b|\bkhawaneej\b/i, "AL KHAWANEEJ"],
  [/\bmuhaisnah\b|\bmuhaisina\b|\bsonapur\b/i, "MUHAISNAH"],
  [/\bal\s*qusais\b|\bqusais\b/i, "AL QUSAIS"],
  [/\bal\s*twar\b|\btwar\b/i, "AL TWAR"],
  [/\bal\s*rashidiya\b.*\bdubai\b|\brashidiya\b.*\bdubai\b/i, "AL RASHIDIYA"],
  [/\bgarhoud\b/i, "AL GARHOUD"],
  [/\bal\s*mamzar\b|\bmamzar\b/i, "AL MAMZAR"],
  [/\bnad\s*al\s*hamar\b/i, "NAD AL HAMAR"],
  [/\bhor\s*al\s*anz\b/i, "HOR AL ANZ"],
  [/\babu\s*hail\b/i, "ABU HAIL"],
  [/\bal\s*muraqqabat\b|\bmuraqabat\b|\bal\s*rigga\b|\brigga\b|\bnaif\b|\bal\s*ras\b|\bdeira\b|\bport\s*saeed\b|\bal\s*muteena\b/i, "DEIRA"],
  [/\bkarama\b/i, "KARAMA"],
  [/\boud\s*metha\b/i, "OUD METHA"],
  [/\bmankhool\b|\bal\s*raffa\b|\bmeena\s*bazaar\b|\bbur\s*dubai\b|\bal\s*fahidi\b/i, "BUR DUBAI"],
  [/\bal\s*jaddaf\b|\bjaddaf\b|\bculture\s*village\b/i, "AL JADDAF"],
  [/\bsatwa\b/i, "SATWA"],
  [/\bal\s*wasl\b/i, "AL WASL"],
  [/\bumm\s*suqeim\b/i, "UMM SUQEIM"],
  [/\bal\s*safa\b/i, "AL SAFA"],
  [/\bjumeirah\b|\bjumeira\b/i, "JUMEIRAH"],
  [/\bpalm\b/i, "PALM JUMEIRAH"],
  [/\bal\s*khail\b|\bnad\s*al\s*sheba\b|\bmeydan\b/i, "MEYDAN / NAD AL SHEBA"],
  [/\bras\s*al\s*khor\b/i, "RAS AL KHOR"],
  [/\bal\s*sufouh\b|\bknowledge\s*village\b|\bmedia\s*city\b|\binternet\s*city\b/i, "MEDIA CITY / SUFOUH"],
  [/\bal\s*nahda\b/i, "AL NAHDA (DXB)"],
];

const SHARJAH: AreaRule[] = [
  [/\bmusall?ah?\b|\bmusala\b/i, "AL MUSALLA"],
  [/\bal\s*ghubaiba\b|\bghubaiba\b/i, "AL GHUBAIBA"],
  [/\bal\s*soor\b|\bsoor\b/i, "AL SOOR"],
  [/\bshuwaihean\b|\bshuwaihein\b/i, "AL SHUWAIHEAN"],
  [/\bmujarrah\b|\bmujarra\b/i, "AL MUJARRAH"],
  [/\bal\s*heera\b|\bheera\b/i, "AL HEERA"],
  [/\bal\s*fisht\b|\bfisht\b/i, "AL FISHT"],
  [/\bal\s*ramla\b|\bramla\b/i, "AL RAMLA"],
  [/\bqadisiya\b|\bqadisiyah\b/i, "AL QADISIYA"],
  [/\bal\s*azra\b|\bazra\b/i, "AL AZRA"],
  [/\bsamnan\b/i, "SAMNAN"],
  [/\bhalwan\b/i, "HALWAN"],
  [/\bal\s*ramtha\b|\bramtha\b/i, "AL RAMTHA"],
  [/\bal\s*layyeh\b|\blayyeh\b/i, "AL LAYYEH"],
  [/\bal\s*jazzat\b|\bjazzat\b/i, "AL JAZZAT"],
  [/\bal\s*ghafia\b|\bghafia\b/i, "AL GHAFIA"],
  [/\bnekhailat\b/i, "AL NEKHAILAT"],
  [/\bal\s*sabkha\b|\bsabkha\b/i, "AL SABKHA"],
  [/\bal\s*darari\b|\bdarari\b/i, "AL DARARI"],
  [/\bal\s*mirgab\b|\bmirgab\b/i, "AL MIRGAB"],
  [/\bmuwaileh\b|\bmuweilah\b|\buniversity\s*city\b/i, "MUWAILEH"],
  [/\bal\s*taawun\b|\btaawun\b|\btaawon\b/i, "AL TAAWUN"],
  [/\bal\s*khan\b/i, "AL KHAN"],
  [/\bal\s*majaz\b|\bmajaz\b/i, "AL MAJAZ"],
  [/\bal\s*qasimia\b|\bqasimiya\b|\bqasimia\b/i, "AL QASIMIA"],
  [/\babu\s*shagara\b/i, "ABU SHAGARA"],
  [/\brolla\b|\bal\s*ghuwair\b|\bal\s*mareija\b/i, "ROLLA"],
  [/\bal\s*butina\b|\bbutina\b/i, "AL BUTINA"],
  [/\bal\s*yarmook\b|\byarmook\b/i, "AL YARMOOK"],
  [/\bal\s*nabba\b|\bnabba\b/i, "AL NABBA"],
  [/\bindustrial\s*area\b|\bind\.?\s*area\b/i, "INDUSTRIAL AREA"],
  [/\bal\s*zahia\b|\bzahia\b/i, "AL ZAHIA"],
  [/\bal\s*rahmaniya\b|\brahmaniya\b/i, "AL RAHMANIYA"],
  [/\bal\s*suyoh\b|\bsuyoh\b|\btilal\b/i, "AL SUYOH / TILAL"],
  [/\bmaysaloon\b|\bal\s*jubail\b|\bjubail\b/i, "AL JUBAIL"],
  [/\bal\s*nahda\b/i, "AL NAHDA (SHJ)"],
  [/\bal\s*rifa\b|\brifa\b/i, "AL RIFA"],
];

const ABUDHABI: AreaRule[] = [
  [/\bmussafah\b|\bmusaffah\b|\bmusafah\b|\bicad\b/i, "MUSSAFAH"],
  [/\bkhalifa\s*city\b|\bkca\b/i, "KHALIFA CITY"],
  [/\bmbz\b|\bmohammed\s*bin\s*zayed\b|\bmohamed\s*bin\s*zayed\b/i, "MBZ CITY"],
  [/\bshamkha\b/i, "AL SHAMKHA"],
  [/\bbaniyas\b|\bbani\s*yas\b/i, "BANIYAS"],
  [/\breem\b/i, "AL REEM ISLAND"],
  [/\byas\b/i, "YAS ISLAND"],
  [/\bsaadiyat\b/i, "SAADIYAT"],
  [/\bal\s*raha\b|\braha\b/i, "AL RAHA"],
  [/\bkhalidiya\b|\bkhalidiyah\b/i, "AL KHALIDIYA"],
  [/\bal\s*bateen\b|\bbateen\b/i, "AL BATEEN"],
  [/\bcorniche\b/i, "CORNICHE"],
  [/\btourist\s*club\b|\bal\s*zahiyah\b/i, "TOURIST CLUB"],
  [/\bal\s*wahda\b|\bwahda\b/i, "AL WAHDA"],
  [/\bhamdan\b|\belectra\b|\bal\s*markaziya\b|\bmadinat\s*zayed\b/i, "CITY CENTRE"],
  [/\bal\s*mushrif\b|\bmushrif\b/i, "AL MUSHRIF"],
  [/\bal\s*muroor\b|\bmuroor\b/i, "AL MUROOR"],
  [/\bal\s*nahyan\b|\bnahyan\b/i, "AL NAHYAN"],
  [/\bal\s*falah\b|\bfalah\b/i, "AL FALAH"],
  [/\bal\s*shahama\b|\bshahama\b/i, "AL SHAHAMA"],
  [/\bal\s*wathba\b|\bwathba\b/i, "AL WATHBA"],
];

const ALAIN: AreaRule[] = [
  [/\bal\s*jimi\b|\bjimi\b/i, "AL JIMI"],
  [/\bmuwaiji\b/i, "AL MUWAIJI"],
  [/\btowayya\b|\btowayya\b|\btawiya\b/i, "AL TOWAYYA"],
  [/\bhili\b/i, "HILI"],
  [/\bkhabisi\b/i, "AL KHABISI"],
  [/\bal\s*mutaredh\b|\bmutaredh\b|\bmutawaa\b/i, "AL MUTAREDH"],
  [/\bal\s*maqam\b|\bmaqam\b/i, "AL MAQAM"],
  [/\bfalaj\s*hazz?a\b|\bfalajaz+a\b|\bfalaj\b/i, "FALAJ HAZZA"],
  [/\bzakher\b/i, "ZAKHER"],
  [/\bsanaiya\b|\bsanaiyah\b|\bindustrial\b/i, "SANAIYA"],
];

const AJMAN: AreaRule[] = [
  [/\bal\s*nuaimiya\b|\bnuaimiya\b|\bnuaimia\b/i, "AL NUAIMIYA"],
  [/\bal\s*rashidiya\b|\brashidiya\b/i, "AL RASHIDIYA (AJM)"],
  [/\bal\s*jurf\b|\bjurf\b/i, "AL JURF"],
  [/\bal\s*rawda\b|\brawda\b/i, "AL RAWDA"],
  [/\bal\s*mowaihat\b|\bmowaihat\b|\bmuwaihat\b/i, "AL MOWAIHAT"],
  [/\bal\s*hamidiya\b|\bhamidiya\b/i, "AL HAMIDIYA"],
  [/\bemirates\s*city\b/i, "EMIRATES CITY"],
  [/\bal\s*zahra\b|\bzahra\b/i, "AL ZAHRA"],
  [/\bal\s*nakheel\b|\bnakheel\b/i, "AL NAKHEEL"],
  [/\bal\s*bustan\b|\bbustan\b/i, "AL BUSTAN"],
  [/\bal\s*helio\b|\bhelio\b/i, "AL HELIO"],
  [/\bal\s*jerf\b/i, "AL JURF"],
];

const BY_EMIRATE: Record<string, AreaRule[]> = {
  DUBAI,
  SHARJAH,
  ABUDHABI,
  "AL AIN": ALAIN,
  AJMAN,
};

/** Best-guess area name, or the first part of the address when no known area matches. */
export function detectArea(address?: string | null, emirate?: string | null): string {
  const text = (address ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "NO ADDRESS";
  const em = (emirate ?? "").toUpperCase();
  const rules = [...(BY_EMIRATE[em] ?? []), ...Object.entries(BY_EMIRATE).filter(([k]) => k !== em).flatMap(([, r]) => r)];
  for (const [re, name] of rules) if (re.test(text)) return name;
  // Fallback: first chunk of the address that has letters (e.g. "Villa 12, Al Something" → "AL SOMETHING").
  const parts = text.split(/[,\n\-–]+/).map((p) => p.trim()).filter((p) => /[a-z]{3}/i.test(p));
  const named = parts.find((p) => p.length <= 25 && !/\d/.test(p) && !/\b(villa|flat|apt|apartment|room|building|bldg|tower|floor|street|st|road|near|opp|behind|makani|plot|house|no|office|shop)\b/i.test(p));
  return named ? canonical(named) : "OTHER AREA";
}

/**
 * Same unknown area written differently ("Al Musalla", "Sharjah Musallah",
 * "musalla") → one name: drop emirate words, a leading "Al", and a trailing "h".
 */
function canonical(name: string): string {
  let t = name
    .replace(/[^\w\s'’]/g, " ")
    .replace(/\b(sharjah|sharja|sharjha|shj|dubai|dxb|abu\s*dhabi|auh|ajman|ajm|al\s*ain|uae|united\s*arab\s*emirates|rak|uaq|fujairah)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  // Comparable form: no leading "Al", no trailing "h" after a vowel, no doubled final vowel.
  t = t.replace(/^AL\s+/, "").replace(/(?<=[AEIOU])H\b/g, "").replace(/([AEIOU])\1\b/g, "$1").trim();
  return t || "OTHER AREA";
}
