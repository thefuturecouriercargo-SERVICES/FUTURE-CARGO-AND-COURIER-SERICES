/**
 * Saving files on iPhone/iPad.
 *
 * iOS (Safari and the home-screen app) ignores `download` and just opens a PDF
 * full-screen with no way to save or share it. There we hand the file to the
 * iOS share sheet instead (Save to Files, WhatsApp, Print…). If iOS refuses
 * because the tap was too long ago (a big PDF took time to build), a small
 * "Save / Share" button appears — one tap on it opens the share sheet.
 * Android and desktop keep the normal download.
 */

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function plainDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Floating button that opens the share sheet with a fresh tap. */
function offerShareButton(file: File, blob: Blob) {
  document.getElementById("fc-share-file")?.remove();
  const wrap = document.createElement("div");
  wrap.id = "fc-share-file";
  wrap.setAttribute(
    "style",
    "position:fixed;left:12px;right:12px;bottom:max(16px,env(safe-area-inset-bottom));z-index:2147483000;display:flex;gap:8px;align-items:center;background:#0F1626;color:#F1D9A0;border:1px solid #D4AF5A;border-radius:16px;padding:10px 12px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:600 14px Inter,system-ui,sans-serif"
  );
  const label = document.createElement("span");
  label.textContent = `📄 ${file.name}`;
  label.setAttribute("style", "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#E8ECF4;font-weight:500;font-size:13px");
  const share = document.createElement("button");
  share.textContent = "Save / Share";
  share.setAttribute("style", "background:#D4AF5A;color:#0A1020;border:0;border-radius:10px;padding:10px 14px;font:700 14px Inter,system-ui,sans-serif");
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.setAttribute("style", "background:transparent;color:#9AA5BA;border:0;font-size:22px;padding:0 4px");
  share.onclick = async () => {
    try {
      await navigator.share({ files: [file], title: file.name });
      wrap.remove();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      // Never navigate into the PDF on iOS — the viewer has no way back.
      label.textContent = "Couldn't open share. Tap Save / Share again.";
    }
  };
  close.onclick = () => wrap.remove();
  wrap.append(label, share, close);
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 120_000);
}

/** Save a file the way the device can: share sheet on iOS, download elsewhere. */
export async function saveBlob(blob: Blob, name: string): Promise<void> {
  if (!isIOS()) return plainDownload(blob, name);
  const file = new File([blob], name, { type: blob.type || "application/pdf" });
  if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // they closed the share sheet
      offerShareButton(file, blob); // tap expired → ask for one more tap
      return;
    }
  }
  plainDownload(blob, name);
}

/** jsPDF documents: `savePdf(doc, "report.pdf")` instead of `doc.save(...)`. */
export function savePdf(doc: { output(type: "blob"): Blob }, name: string): Promise<void> {
  return saveBlob(doc.output("blob"), name);
}

/** File name from a Content-Disposition header, or a fallback. */
function nameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  const raw = m?.[1] ? decodeURIComponent(m[1]) : m?.[2];
  return raw || fallback;
}

/** True for our own server download links (PDF / Excel exports). */
function isExportLink(a: HTMLAnchorElement): boolean {
  const href = a.getAttribute("href") ?? "";
  if (!href.startsWith("/api/")) return false;
  return /[?&]format=(pdf|excel|xlsx)\b|\/pdf\b|\/export\b|\/backup\b|\.pdf\b/i.test(href);
}

let installed = false;
/** On iOS, catch taps on export links and save them via the share sheet. */
export function installIOSDownloadFix() {
  if (installed || typeof document === "undefined" || !isIOS()) return;
  installed = true;
  document.addEventListener(
    "click",
    async (ev) => {
      const a = (ev.target as Element | null)?.closest?.("a");
      if (!a || !isExportLink(a as HTMLAnchorElement)) return;
      ev.preventDefault();
      const href = (a as HTMLAnchorElement).href;
      try {
        const res = await fetch(href, { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const ext = /excel|xlsx|spreadsheet/i.test(blob.type) ? "xlsx" : "pdf";
        await saveBlob(blob, nameFrom(res, `future-courier.${ext}`));
      } catch {
        alert("Could not export the file. Please try again."); // never open the PDF full-screen on iOS
      }
    },
    true
  );
}
