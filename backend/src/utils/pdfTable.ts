// Shared styling helpers for PDF report tables — used across the Consignment,
// Expense, P&L, and Employee Performance exports so they all look consistent.

export const PDF_COLORS = {
  navy: "#141F33",
  navy2: "#1E2E4C",
  brass: "#B08A34",
  brassLight: "#DDC48A",
  paper: "#FAF8F4",
  zebra: "#F5F3EE",
  border: "#DCD5C7",
  ink: "#1A1A1A",
  inkSoft: "#5A5A5A",
  delivered: "#1E7145",
  deliveredBg: "#E4F0E7",
  pending: "#B9760C",
  pendingBg: "#FBEEDA",
  cancelled: "#AC3529",
  cancelledBg: "#F7E6E3",
  transferred: "#2B5AA6",
  transferredBg: "#E4EBF7",
};

export function statusColors(status: string): { bg: string; color: string } {
  switch (status) {
    case "DELIVERED":
      return { bg: PDF_COLORS.deliveredBg, color: PDF_COLORS.delivered };
    case "PENDING":
      return { bg: PDF_COLORS.pendingBg, color: PDF_COLORS.pending };
    case "CANCELLED":
      return { bg: PDF_COLORS.cancelledBg, color: PDF_COLORS.cancelled };
    case "TRANSFER":
      return { bg: PDF_COLORS.transferredBg, color: PDF_COLORS.transferred };
    default:
      return { bg: "#EFEFEF", color: PDF_COLORS.inkSoft };
  }
}

export interface PdfRowStyle {
  bg?: string;
  color?: string;
  bold?: boolean;
  fontSize?: number;
  align?: ("left" | "right" | "center")[];
  statusColIndex?: number; // if set, that column's text is colored by its own status value
}

/**
 * Draws one styled table row: optional background fill, bordered cells, and
 * per-cell text. Returns nothing — caller advances y by rowHeight themselves.
 */
export function drawPdfRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  rowHeight: number,
  values: (string | number)[],
  colWidths: number[],
  style: PdfRowStyle = {}
): void {
  const totalWidth = colWidths.reduce((s, w) => s + w, 0);

  if (style.bg) {
    doc.rect(x, y - 4, totalWidth, rowHeight).fill(style.bg);
  }
  doc
    .rect(x, y - 4, totalWidth, rowHeight)
    .strokeColor(PDF_COLORS.border)
    .lineWidth(0.5)
    .stroke();

  let cx = x;
  values.forEach((v, i) => {
    const isStatusCol = style.statusColIndex === i;
    const cellColor = isStatusCol ? statusColors(String(v)).color : style.color ?? PDF_COLORS.ink;
    doc
      .font(style.bold || isStatusCol ? "Helvetica-Bold" : "Helvetica")
      .fontSize(style.fontSize ?? 8.5)
      .fillColor(cellColor)
      .text(String(v), cx + 5, y, {
        width: colWidths[i] - 8,
        align: style.align?.[i] ?? "left",
        ellipsis: true,
      });
    cx += colWidths[i];
  });
}

/** Draws a colored section title bar (used above summary blocks like Category Totals). */
export function drawPdfSectionBar(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string): number {
  doc.rect(x, y - 4, width, 20).fill(PDF_COLORS.navy);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF").text(label, x + 6, y, { width: width - 12 });
  return y + 20;
}
