"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Styled toasts and confirm pop-ups for the admin app, replacing the browser's
 * plain alert()/confirm() boxes.
 *
 *   toast("Consignment added", "success")
 *   if (!(await confirmDialog("Delete this consignment?"))) return;
 *
 * <FeedbackHost /> is mounted once in the admin shell. Anywhere it isn't mounted
 * (vendor/driver portals) both helpers fall back to the native browser boxes, so
 * shared components keep working everywhere.
 */

type ToastKind = "success" | "error" | "info" | "warning";
interface ToastItem {
  id: number;
  title: string;
  detail?: string;
  kind: ToastKind;
}
interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}
interface ConfirmRequest extends ConfirmOptions {
  message: string;
  resolve: (ok: boolean) => void;
}

let toastListener: ((t: ToastItem) => void) | null = null;
let confirmListener: ((c: ConfirmRequest) => void) | null = null;
let nextId = 1;

export function toast(title: string, kind: ToastKind = "success", detail?: string) {
  if (!toastListener) {
    if (typeof window !== "undefined") window.alert(detail ? `${title}\n\n${detail}` : title);
    return;
  }
  toastListener({ id: nextId++, title, detail, kind });
}

const DANGER_WORDS = /\b(delete|remove|deactivate|reset|permanently)\b/i;

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (!confirmListener) {
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  }
  const listener = confirmListener;
  return new Promise((resolve) => listener({ message, resolve, ...options }));
}

/** Guess a toast style from free-form alert text (used for the alert() bridge). */
function kindFor(text: string): ToastKind {
  if (/could not|failed|error|cannot|can't|invalid|not found/i.test(text)) return "error";
  if (/choose|please|warning|check/i.test(text)) return "warning";
  if (/done|saved|added|marked|updated|success/i.test(text)) return "success";
  return "info";
}

const KIND_STYLE: Record<ToastKind, { ring: string; badge: string; icon: string }> = {
  success: { ring: "border-delivered/40 bg-[#0F1A17]", badge: "bg-[rgb(var(--c-delivered))] text-[#062016]", icon: "M5 12l5 5L20 7" },
  error: { ring: "border-cancelled/40 bg-[#1C0F11]", badge: "bg-[rgb(var(--c-cancelled))] text-[#2A0A0A]", icon: "M6 6l12 12M18 6L6 18" },
  warning: { ring: "border-brass/40 bg-[#1A160D]", badge: "bg-brass text-[#14100A]", icon: "M12 7v6M12 17h.01" },
  info: { ring: "border-transferred/40 bg-[#0D1626]", badge: "bg-[rgb(var(--c-transferred))] text-[#06122A]", icon: "M12 11v6M12 7h.01" },
};

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    toastListener = (t) => {
      setToasts((list) => [...list.slice(-3), t]);
      setTimeout(() => setToasts((list) => list.filter((x) => x.id !== t.id)), t.kind === "error" ? 7000 : 4500);
    };
    confirmListener = (c) => setRequest(c);
    // Route any remaining alert() calls in admin pages to the styled toast.
    const nativeAlert = window.alert;
    window.alert = (msg?: unknown) => {
      const text = String(msg ?? "");
      const [first, ...rest] = text.split(/\n\n/);
      toast(first, kindFor(text), rest.join("\n\n") || undefined);
    };
    return () => {
      toastListener = null;
      confirmListener = null;
      window.alert = nativeAlert;
    };
  }, []);

  useEffect(() => {
    if (!request) return;
    confirmBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  function close(ok: boolean) {
    request?.resolve(ok);
    setRequest(null);
  }

  const danger = request ? request.danger ?? DANGER_WORDS.test(request.message) : false;
  const [msgTitle, ...msgRest] = (request?.message ?? "").split(/\n\n/);

  return (
    <>
      {request && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(3,6,14,0.65)] p-4 backdrop-blur-[2px]" onMouseDown={() => close(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label={request.title ?? msgTitle}
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[20px] border border-[#3A3220] bg-[#111827] p-6 text-ink shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
            style={{ animation: "assistant-reveal 160ms ease-out" }}
          >
            <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${danger ? "bg-cancelled-bg text-cancelled" : "bg-[#1A1F2E] text-brass"}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                {danger ? <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /> : <path d="M12 8v5M12 16h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />}
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold text-white">{request.title ?? msgTitle}</h2>
            {(request.title || msgRest.length > 0) && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{request.title ? request.message : msgRest.join("\n\n")}</p>
            )}
            <div className="mt-6 flex justify-end gap-2.5">
              <button onClick={() => close(false)} className="touch-target rounded-xl border border-line px-4 text-sm text-ink hover:border-ink-soft">
                {request.cancelText ?? "Cancel"}
              </button>
              <button
                ref={confirmBtn}
                onClick={() => close(true)}
                className={`touch-target rounded-xl px-5 text-sm font-semibold ${danger ? "bg-[#B91C1C] text-white hover:bg-[#991B1B]" : "bg-[#D4AF5A] text-[#14100A] hover:bg-[#E9CB82]"}`}
              >
                {request.confirmText ?? (danger ? "Yes, continue" : "OK")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed right-4 top-[132px] z-[110] flex w-[min(340px,calc(100vw-2rem))] flex-col gap-2.5 md:top-[88px]">
        {toasts.map((t) => {
          const s = KIND_STYLE[t.kind];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 text-ink shadow-[0_12px_30px_rgba(0,0,0,0.5)] ${s.ring}`}
              style={{ animation: "assistant-reveal 200ms ease-out" }}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${s.badge}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                  <path d={s.icon} />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">{t.title}</p>
                {t.detail && <p className="mt-0.5 whitespace-pre-line text-xs text-ink-soft">{t.detail}</p>}
              </div>
              <button
                aria-label="Dismiss"
                onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
                className="-mr-1 text-ink-soft hover:text-white"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
