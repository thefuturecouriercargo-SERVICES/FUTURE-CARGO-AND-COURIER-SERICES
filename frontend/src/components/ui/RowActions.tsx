"use client";

import { useEffect, useRef, useState } from "react";

export interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** "⋯" button that opens a small menu of row actions (Edit, Delete, …). */
export default function RowActions({ actions, label = "Row actions" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Phones fire small scroll/resize events on their own (toolbar hiding,
    // momentum, the tap itself), which used to shut the menu before the tap on
    // "Edit" landed. Only close once the page has really moved.
    const startY = window.scrollY;
    const startW = window.innerWidth;
    function onScroll(e: Event) {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      if (Math.abs(window.scrollY - startY) > 60) setOpen(false);
    }
    function onResize() {
      if (window.innerWidth !== startW) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  function toggle() {
    if (!open && ref.current) {
      // Fixed-position menu so a scrolling table box can't clip it; opens
      // upwards when the button is near the bottom of the screen.
      const r = ref.current.getBoundingClientRect();
      const menuH = 48 + actions.length * 42;
      const top = r.bottom + menuH + 8 > window.innerHeight ? r.top - menuH - 6 : r.bottom + 6;
      setPos({ top, left: Math.max(8, r.right - 176) });
    }
    setOpen((o) => !o);
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={`flex h-9 w-9 items-center justify-center rounded-lg border text-base leading-none transition ${
          open ? "border-brass/50 bg-paper-2 text-brass" : "border-transparent text-ink-soft hover:border-line hover:text-navy"
        }`}
      >
        ⋯
      </button>
      {open && pos && (
        <div
          role="menu"
          style={pos ?? undefined}
          className="fixed z-[80] w-44 rounded-xl border border-line bg-white p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.45)]"
        >
          {actions.map((a, i) => (
            <div key={a.label}>
              {a.danger && i > 0 && <div className="mx-1.5 my-1 h-px bg-line" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  window.setTimeout(a.onClick, 0);
                }}
                className={`flex h-10 w-full items-center rounded-lg px-3 text-left text-[13px] ${
                  a.danger ? "text-cancelled hover:bg-cancelled-bg" : "text-ink hover:bg-paper-2"
                }`}
              >
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
