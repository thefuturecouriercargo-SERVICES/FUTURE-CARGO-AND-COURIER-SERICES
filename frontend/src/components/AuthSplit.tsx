import type { ReactNode } from "react";

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
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
              <img src="/fc-logo-mark.png" alt="Future Courier" className="h-full w-full object-contain" />
              <span className="fc-shine pointer-events-none absolute inset-y-0 w-1/2 -skew-x-[20deg] bg-[rgba(212,175,55,0.6)]" aria-hidden />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-display text-lg font-semibold text-white" aria-label="Future Courier">
                {"Future Courier".split("").map((ch, i) => (
                  <span key={i} className="fc-letter inline-block" style={{ animationDelay: `${0.6 + i * 0.05}s` }} aria-hidden>
                    {ch === " " ? "\u00a0" : ch}
                  </span>
                ))}
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
.fc-shine{left:-80%;animation:fcShine .9s .2s cubic-bezier(.4,0,.2,1) both}
.fc-letter{animation:fcLetter .3s both}
.fc-fade{animation:fcLetter .5s both}
.fc-rise{animation:fcRise .6s 1.1s cubic-bezier(.2,.8,.2,1) both}
.fc-fill{animation:fcFill .5s ease-out both}
@media (prefers-reduced-motion:reduce){.fc-shine,.fc-letter,.fc-fade,.fc-rise,.fc-fill{animation:none}}
`}</style>
    </div>
  );
}
