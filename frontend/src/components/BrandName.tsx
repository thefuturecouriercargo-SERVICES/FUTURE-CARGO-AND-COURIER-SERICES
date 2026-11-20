"use client";

import { useState } from "react";

/**
 * "FUTURE COURIER" with the last R inside a thin gold circle.
 * Tapping the circled R refreshes the app (the only manual refresh —
 * pull-down-to-refresh is switched off).
 */
export default function BrandName({ className = "" }: { className?: string }) {
  const [spin, setSpin] = useState(false);
  return (
    <span className={`${className} inline-flex items-center whitespace-nowrap`}>
      Future Courie
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setSpin(true);
          window.dispatchEvent(new Event("fc-refresh-now"));
        }}
        className="fc-r-ring relative ml-[2px] inline-flex h-[1.22em] w-[1.22em] shrink-0 items-center justify-center rounded-full active:scale-90"
        style={{ border: "1.5px solid #D4AF37", font: "inherit", color: "inherit", lineHeight: 1, padding: 0, background: "transparent" }}
      >
        <span className={spin ? "fc-r-spin" : undefined} style={{ display: "inline-block", lineHeight: 1, fontSize: "0.88em" }}>
          R
        </span>
      </button>
      <style>{`.fc-r-spin{animation:fcRSpin .6s linear infinite}@keyframes fcRSpin{to{transform:rotate(360deg)}}.fc-r-ring{animation:fcRGlow 2.4s ease-in-out infinite}@keyframes fcRGlow{0%,100%{box-shadow:0 0 0 0 rgba(212,175,55,0)}50%{box-shadow:0 0 8px 1px rgba(212,175,55,.7)}}@media (prefers-reduced-motion:reduce){.fc-r-ring{animation:none}}`}</style>
    </span>
  );
}
