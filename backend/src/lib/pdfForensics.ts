import { PDFDocument, PDFName } from "pdf-lib";

/**
 * Hard checks on a receipt PDF's file details — things the page itself doesn't show.
 * Built from 21 genuine UAE bank receipts + 1 edited fake (24 Nov 2026):
 *  - genuine: made by the bank app (openhtmltopdf, OpenPDF/Jasper, PDFService, PDFKit, iOS Quartz),
 *    created at the transfer time, never modified, no form layer, saved once.
 *  - fake: made by a PDF editor, created months before the "transfer", modified later, AcroForm added.
 */
const EDITORS =
  /ilovepdf|smallpdf|sejda|pdfescape|foxit|nitro|pdf ?expert|pdfelement|wondershare|acrobat|adobe|canva|microsoft|word|libreoffice|openoffice|photoshop|pdf-xchange|xchange|inkscape|xodo|pdffiller|dochub|docfly|pdf candy|pdf24|camscanner|lightpdf|soda pdf|abbyy|kami|goodnotes|^\s*\d+\.\d+\.\d+\s*\(\d+\.\d+\.\d+\)\s*$/i;

export type PdfCheck = { flags: string[]; producer: string | null; created: Date | null };

export async function checkReceiptPdf(buf: Buffer, printedDate?: string | null): Promise<PdfCheck> {
  const flags: string[] = [];
  let producer: string | null = null;
  let created: Date | null = null;
  try {
    const raw = buf.toString("latin1");
    const saves = raw.split("%%EOF").length - 1;
    if (saves > 1) flags.push(`PDF SAVED ${saves} TIMES — EDITED AFTER IT WAS MADE`);
    const d = await PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true });
    producer = (d.getProducer() ?? "").trim() || null;
    const creator = (d.getCreator() ?? "").trim();
    created = d.getCreationDate() ?? null;
    const modified = d.getModificationDate() ?? null;
    const maker = [producer, creator].filter(Boolean).join(" / ");
    if (maker && EDITORS.test(maker)) flags.push(`PDF MADE / EDITED WITH "${maker.slice(0, 40).toUpperCase()}" — NOT A BANK APP`);
    if (d.catalog.get(PDFName.of("AcroForm"))) flags.push("PDF HAS AN EDITING (FORM) LAYER");
    if (created && modified && modified.getTime() - created.getTime() > 2 * 60 * 1000) {
      const days = Math.round((modified.getTime() - created.getTime()) / 86_400_000);
      flags.push(`PDF MODIFIED AFTER IT WAS MADE${days >= 1 ? ` (${days} DAYS LATER)` : ""}`);
    }
    if (created && printedDate && /^\d{4}-\d{2}-\d{2}$/.test(printedDate)) {
      const printed = new Date(`${printedDate}T00:00:00+04:00`).getTime();
      if (created.getTime() < printed - 86_400_000) {
        flags.push(`PDF CREATED ${created.toISOString().slice(0, 10)} — BEFORE THE TRANSFER DATE ${printedDate}`);
      }
    }
  } catch {
    // Not readable as a PDF — leave it to the visual check.
  }
  return { flags, producer, created };
}

/** The file name often carries the bank's reference (receipt_049288536249B7BD.pdf). A near-miss vs the printed reference = edited. */
export function fileNameRefMismatch(fileName: string | null | undefined, printedRef: string | null | undefined): string | null {
  const ref = String(printedRef ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!fileName || ref.length < 8) return null;
  const tokens = String(fileName).toUpperCase().replace(/\.[A-Z]+$/, "").split(/[^A-Z0-9]+/).filter((t) => t.length === ref.length);
  for (const t of tokens) {
    if (t === ref) return null;
    let diff = 0;
    for (let i = 0; i < t.length; i++) if (t[i] !== ref[i]) diff++;
    if (diff > 0 && diff <= Math.ceil(ref.length / 3)) return `FILE NAME SAYS REFERENCE ${t} BUT RECEIPT SHOWS ${ref}`;
  }
  return null;
}
