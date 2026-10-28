import type { ReactNode } from "react";

const ICONS = {
  box: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  check: "M5 12l5 5L20 7",
  inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
};

/** Friendly "nothing here" panel: icon, one-line title, hint and optional actions. */
export default function EmptyState({
  title,
  hint,
  icon = "box",
  tone = "gold",
  children,
  compact,
}: {
  title: string;
  hint?: string;
  icon?: keyof typeof ICONS;
  tone?: "gold" | "green";
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${compact ? "py-8" : "py-14"}`}>
      <div
        className={`flex items-center justify-center rounded-full ${compact ? "h-14 w-14" : "h-20 w-20"} ${
          tone === "green" ? "bg-delivered-bg text-delivered" : "bg-paper-2 text-brass shadow-[0_0_40px_rgba(212,175,90,0.15)]"
        } ring-8 ring-[rgb(var(--c-paper)/0.6)]`}
      >
        <svg width={compact ? 24 : 32} height={compact ? 24 : 32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={ICONS[icon]} />
        </svg>
      </div>
      <p className={`font-display font-semibold text-navy ${compact ? "text-[15px]" : "text-lg"}`}>{title}</p>
      {hint && <p className="max-w-sm text-sm leading-relaxed text-ink-soft">{hint}</p>}
      {children && <div className="mt-1 flex flex-wrap justify-center gap-2.5">{children}</div>}
    </div>
  );
}
