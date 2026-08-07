import PDFDocument from "pdfkit";
import path from "path";

const HEADER_IMAGE = path.join(__dirname, "../assets/letterhead-header.jpeg");
const FOOTER_IMAGE = path.join(__dirname, "../assets/letterhead-footer.jpeg");

// Aspect ratio of the source images (width:height), used to scale consistently.
const HEADER_ASPECT = 2550 / 600;
const FOOTER_ASPECT = 2550 / 550;

/**
 * Draws the company letterhead header at the top of the current page,
 * followed by an auto-stamped export date. Returns the Y position where
 * report content should start.
 */
export function drawLetterheadHeader(doc: PDFKit.PDFDocument, title: string): number {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const headerWidth = pageWidth;
  const headerHeight = headerWidth / HEADER_ASPECT;

  doc.image(HEADER_IMAGE, doc.page.margins.left, doc.page.margins.top, {
    width: headerWidth,
    height: headerHeight,
  });

  let y = doc.page.margins.top + headerHeight + 10;

  doc.fontSize(14).fillColor("#000").font("Helvetica-Bold").text(title, doc.page.margins.left, y, {
    width: pageWidth,
    align: "center",
  });
  y = doc.y + 4;

  const exportDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  doc.fontSize(9).fillColor("#555").font("Helvetica").text(`Exported on: ${exportDate}`, doc.page.margins.left, y, {
    width: pageWidth,
    align: "center",
  });
  y = doc.y + 12;

  return y;
}

/**
 * Draws the company letterhead footer (seal + name) at the bottom of the
 * current page. Call this right before doc.addPage() or doc.end().
 */
export function drawLetterheadFooter(doc: PDFKit.PDFDocument): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const footerWidth = Math.min(pageWidth, 250);
  const footerHeight = footerWidth / FOOTER_ASPECT;
  const y = doc.page.height - doc.page.margins.bottom - footerHeight;

  doc.image(FOOTER_IMAGE, doc.page.margins.left, y, {
    width: footerWidth,
    height: footerHeight,
  });
}
