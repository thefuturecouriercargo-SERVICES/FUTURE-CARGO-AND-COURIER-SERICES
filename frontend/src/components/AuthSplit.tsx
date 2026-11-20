import type { ReactNode } from "react";

// Warp-speed streaks on the phone sign-in screen: [left %, top %, delay s].
const WARP: [number, number, number][] = Array.from({ length: 30 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return [Math.round(r(1) * 100), Math.round(r(2) * 100), Math.round(r(3) * 1100) / 1000];
});

const POINTS = ["Every consignment tracked from entry to delivery", "Driver, agent and vendor portals in one place", "Daily cash closing, payroll and reports"];

/**
 * Split-screen sign-in layout: brand panel on the left (hidden on phones,
 * where a compact logo header shows instead), the form card on the right.
 */
export default function AuthSplit({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="theme-midnight admin-shell flex min-h-screen bg-paper text-ink">
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden border-r border-[#1B2438] bg-[#0A1020] p-10 lg:flex xl:p-14">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border border-[#3A3220]" aria-hidden />
        <div className="pointer-events-none absolute -right-20 -top-20 h-[340px] w-[340px] rounded-full border border-[#3A3220]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,90,0.12),transparent_65%)]" aria-hidden />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_0_28px_rgba(212,175,90,0.3)]"><img src="/fc-logo-mark.png" alt="Future Courier" className="h-full w-full object-contain" /></div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-lg font-semibold text-white">Future Courier</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#D4AF5A]">{eyebrow}</span>
          </div>
        </div>

        <div className="relative">
          <h1 className="font-display text-[40px] font-semibold leading-[1.15] tracking-tight text-white xl:text-[46px]">
            Every parcel,
            <br />
            every emirate,
            <br />
            <span className="text-[#D4AF5A]">on time.</span>
          </h1>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px] text-[#C9D1E0]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1A1F2E] text-[#D4AF5A]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-[#6F7B93]">The Future Courier Service L.L.C</p>
      </aside>

      <main className="relative flex flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_top,rgba(212,175,90,0.08),transparent_60%)] px-4 py-10">
        <div className="fc-warp pointer-events-none absolute inset-0 overflow-hidden lg:hidden" aria-hidden>
          {WARP.map((w, i) => (
            <i key={i} style={{ left: `${w[0]}%`, top: `${w[1]}%`, animationDelay: `${w[2]}s`, background: `linear-gradient(90deg,transparent,${i % 3 ? "#D4AF37" : "#ffffff"})` }} />
          ))}
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="relative h-11 w-11 shrink-0">
              <div className="fc-tile absolute inset-0 rounded-xl" style={{ background: "#ffffff" }} />
              <img src="/fc-logo-f.png" alt="" className="fc-pf absolute inset-0 h-full w-full" />
              <img src="/fc-logo-c.png" alt="Future Courier" className="fc-pc absolute inset-0 h-full w-full" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="fc-fade font-display text-lg font-semibold text-white" style={{ animationDelay: "1.15s" }}>
                Future Courier
              </span>
              <span className="fc-fade text-[10px] font-semibold uppercase tracking-[0.22em] text-[#D4AF5A]" style={{ animationDelay: "1.35s" }}>{eyebrow}</span>
            </div>
          </div>
          {children}
        </div>
      </main>
      <style>{`
@keyframes fcShine{0%{left:-80%}100%{left:140%}}
@keyframes fcLetter{0%{opacity:0;transform:translateY(6px)}100%{opacity:1;transform:none}}
@keyframes fcRise{0%{opacity:0;transform:translateY(24px)}100%{opacity:1;transform:none}}
@keyframes fcFill{0%{width:0}100%{width:100%}}
.fc-warp i{position:absolute;height:1.5px;width:44px;border-radius:2px;opacity:0;animation:fcWarp .55s ease-in 2 both}
@keyframes fcWarp{0%{transform:translateX(-260px) scaleX(.3);opacity:0}30%{opacity:1}100%{transform:translateX(320px) scaleX(2.2);opacity:0}}
.fc-tile{animation:fcPop .45s .5s cubic-bezier(.34,1.56,.64,1) both}
@keyframes fcPop{0%{transform:scale(0)}100%{transform:none}}
.fc-pf{animation:fcInL .5s .7s cubic-bezier(.2,.8,.2,1) both}
.fc-pc{animation:fcInR .5s .8s cubic-bezier(.2,.8,.2,1) both}
@keyframes fcInL{0%{transform:translateX(-300px) scaleX(2);filter:blur(4px);opacity:0}30%{opacity:1}100%{transform:none;filter:blur(0);opacity:1}}
@keyframes fcInR{0%{transform:translateX(300px) scaleX(2);filter:blur(4px);opacity:0}30%{opacity:1}100%{transform:none;filter:blur(0);opacity:1}}
.fc-letter{animation:fcLetter .3s both}
.fc-fade{animation:fcLetter .5s both}
.fc-rise{animation:fcRise .6s 1.3s cubic-bezier(.2,.8,.2,1) both}
.fc-fill{animation:fcFill .5s ease-out both}
@media (prefers-reduced-motion:reduce){.fc-warp,.fc-tile,.fc-pf,.fc-pc,.fc-fade,.fc-rise,.fc-fill{animation:none}.fc-warp{display:none}}
`}</style>
    </div>
  );
}
