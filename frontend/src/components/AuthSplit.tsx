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
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF5A] font-display text-base font-bold text-[#0A1020] shadow-[0_0_28px_rgba(212,175,90,0.3)]">FC</div>
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
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D4AF5A] font-display text-base font-bold text-[#0A1020]">FC</div>
            <div className="flex flex-col leading-tight">
              <span className="font-display text-lg font-semibold text-white">Future Courier</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#D4AF5A]">{eyebrow}</span>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
