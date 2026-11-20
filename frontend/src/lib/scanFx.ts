/**
 * Scan feedback for the black & gold scanners (Assign + Scan to update).
 * Good scan  → camera border flashes green, camera tints green, a tick draws itself.
 * Already / error → whole-screen edge glows amber / red and the result box shakes.
 * Every 10th good scan → gold tint, gold sparks and "10 PARCELS".
 * `root` is the full-screen scanner shell; the camera box is the <video>'s parent,
 * the result box is marked with data-scan-result.
 */
export type ScanFxKind = "ok" | "dup" | "err";

const GREEN = "151,196,89";
const AMBER = "233,196,106";
const RED = "226,75,74";

function el(parent: HTMLElement, css: string, html = "") {
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;pointer-events:none;z-index:30;${css}`;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

export function scanFeedback(root: HTMLElement | null, kind: ScanFxKind, count = 0) {
  if (!root || typeof root.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const cam = root.querySelector("video")?.parentElement as HTMLElement | null;
  const box = root.querySelector("[data-scan-result]") as HTMLElement | null;

  if (kind === "ok") {
    if (cam) {
      cam.animate(
        [
          { borderColor: `rgb(${GREEN})`, boxShadow: `0 0 22px rgba(${GREEN},.9)` },
          { borderColor: "#b08a35", boxShadow: "0 0 0 rgba(0,0,0,0)" },
        ],
        { duration: 800, easing: "ease-out" }
      );
      const tint = el(cam, `inset:0;background:rgba(${GREEN},.35)`);
      tint.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 700 }).onfinish = () => tint.remove();
      const tick = el(
        cam,
        "left:50%;top:50%;width:56px;height:56px;margin:-28px",
        `<svg width="56" height="56" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="rgba(5,8,15,.75)" stroke="rgb(${GREEN})" stroke-width="3" stroke-dasharray="139" stroke-dashoffset="139"><animate attributeName="stroke-dashoffset" to="0" dur=".3s" fill="freeze"/></circle><path d="M15 27 l7 7 l14 -16" fill="none" stroke="rgb(${GREEN})" stroke-width="4" stroke-linecap="round" stroke-dasharray="40" stroke-dashoffset="40"><animate attributeName="stroke-dashoffset" to="0" dur=".22s" begin=".25s" fill="freeze"/></path></svg>`
      );
      tick.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: 950 }).onfinish = () => tick.remove();
    }
    if (count > 0 && count % 10 === 0) window.setTimeout(() => milestone(root, cam, count), 300);
    return;
  }

  const rgb = kind === "dup" ? AMBER : RED;
  const glow = el(root, `inset:0;position:fixed;box-shadow:inset 0 0 0 3px rgba(${rgb},.95),inset 0 0 60px rgba(${rgb},.55)`);
  glow.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 900 }).onfinish = () => glow.remove();
  box?.animate(
    [
      { transform: "none", borderColor: `rgb(${rgb})` },
      { transform: "translateX(-8px)", borderColor: `rgb(${rgb})` },
      { transform: "translateX(8px)", borderColor: `rgb(${rgb})` },
      { transform: "translateX(-4px)" },
      { transform: "none" },
    ],
    { duration: 450 }
  );
}

function milestone(root: HTMLElement, cam: HTMLElement | null, count: number) {
  const r = (cam ?? root).getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  if (cam) {
    const t = el(cam, `inset:0;background:rgba(${AMBER},.5)`);
    t.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 900 }).onfinish = () => t.remove();
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const s = el(root, `position:fixed;left:${cx}px;top:${cy}px;width:7px;height:7px;margin:-3.5px;border-radius:50%;background:${i % 2 ? "#e9c46a" : "#fff"}`);
    s.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: `translate(${Math.round(Math.cos(a) * 120)}px,${Math.round(Math.sin(a) * 90)}px)`, opacity: 0 },
      ],
      { duration: 900, easing: "ease-out" }
    ).onfinish = () => s.remove();
  }
  const label = el(
    root,
    `position:fixed;left:${cx}px;top:${r.top - 30}px;transform:translateX(-50%);color:#e9c46a;font:700 14px ui-monospace,monospace;letter-spacing:2px;white-space:nowrap`,
    `${count} PARCELS`
  );
  label.animate(
    [
      { opacity: 0, transform: "translate(-50%,10px) scale(.8)" },
      { opacity: 1, transform: "translate(-50%,0) scale(1.1)", offset: 0.3 },
      { opacity: 1, transform: "translate(-50%,0) scale(1)", offset: 0.8 },
      { opacity: 0, transform: "translate(-50%,0) scale(1)" },
    ],
    { duration: 1500 }
  ).onfinish = () => label.remove();
}

/** Opening: scanner starts close and blurry, then pulls back sharp ("focus zoom out"). */
export function scannerOpenFx(shell: HTMLElement | null) {
  if (!shell || typeof shell.animate !== "function") return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    shell.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
    return;
  }
  shell.animate([{ backgroundColor: "rgba(5,8,15,0)" }, { backgroundColor: "rgba(5,8,15,1)", offset: 0.35 }, { backgroundColor: "rgba(5,8,15,1)" }], { duration: 850, easing: "ease-in" });
  const inner = shell.firstElementChild as HTMLElement | null;
  inner?.animate(
    [
      { opacity: 0, filter: "blur(12px)", transform: "scale(1.6)" },
      { opacity: 1, offset: 0.3 },
      { opacity: 1, filter: "blur(0px)", transform: "none" },
    ],
    { duration: 850, easing: "cubic-bezier(.32,.72,0,1)" }
  );
}
