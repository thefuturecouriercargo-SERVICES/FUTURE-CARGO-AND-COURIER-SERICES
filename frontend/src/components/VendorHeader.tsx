"use client";

import { FeedbackHost } from "@/components/ui/Feedback";

/** Premium top bar for every vendor portal page (also mounts styled pop-ups). */
export default function VendorHeader({ name, onLogout }: { name: string; onLogout: () => void }) {
  const initials = name.trim().slice(0, 2).toUpperCase();
  return (
    <>
      <FeedbackHost />
      <div className="flex h-[68px] items-center justify-between gap-3 border-b border-[#1B2438] bg-[#0A1020] px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D4AF5A] font-display text-[15px] font-bold text-[#0A1020] shadow-[0_0_24px_rgba(212,175,90,0.25)]">FC</div>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-semibold text-white">Future Courier</span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#D4AF5A]">Vendor Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2.5 sm:flex">
            <span className="text-[13px] font-semibold text-white">{name}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#D4AF5A] bg-[#18213A] text-xs font-semibold text-[#D4AF5A]">{initials}</span>
          </div>
          <button onClick={onLogout} className="touch-target rounded-xl border border-[#243049] px-3.5 text-[13px] text-[#9AA5BA] transition hover:border-[#D4AF5A] hover:text-white">
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
