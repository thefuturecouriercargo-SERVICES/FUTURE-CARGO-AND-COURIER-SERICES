"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Sign-in "gold doors": after a successful sign-in the login page fires
 * `fc-doors-close`; two gold doors (F | C) close with a greeting, the app
 * navigates underneath, and the doors open again on the new page.
 */
export function closeGoldDoors(name: string) {
  window.dispatchEvent(new CustomEvent("fc-doors-close", { detail: { name } }));
  return new Promise<void>((r) => setTimeout(r, 900));
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function GoldDoors() {
  const [phase, setPhase] = useState<"idle" | "closing" | "closed" | "opening">("idle");
  const [name, setName] = useState("");
  const pathname = usePathname();
  const startPath = useRef<string | null>(null);

  useEffect(() => {
    const onClose = (e: Event) => {
      const n = (e as CustomEvent<{ name?: string }>).detail?.name ?? "";
      setName(n.trim().split(/\s+/)[0] ?? "");
      startPath.current = window.location.pathname;
      setPhase("closing");
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase("closed")));
    };
    window.addEventListener("fc-doors-close", onClose);
    return () => window.removeEventListener("fc-doors-close", onClose);
  }, []);

  // Open once the new page is showing (or after 4 s, whatever happens).
  useEffect(() => {
    if (phase !== "closed") return;
    const moved = startPath.current !== null && pathname !== startPath.current;
    const t = setTimeout(() => setPhase("opening"), moved ? 450 : 4000);
    return () => clearTimeout(t);
  }, [phase, pathname]);

  useEffect(() => {
    if (phase !== "opening") return;
    const t = setTimeout(() => setPhase("idle"), 650);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  const shut = phase === "closed";
  const ease = "transform .5s cubic-bezier(.65,0,.35,1)";
  return (
    <div className="pointer-events-auto fixed inset-0 z-[200] overflow-hidden" aria-hidden>
      <div className="absolute inset-y-0 left-0 flex w-1/2 items-center justify-end border-r border-[#a8842f] bg-[#C9A24A]" style={{ transform: shut ? "none" : "translateX(-101%)", transition: ease }}>
        <span className="mr-1 font-display text-5xl font-extrabold italic text-[#14213D]">F</span>
      </div>
      <div className="absolute inset-y-0 right-0 flex w-1/2 items-center justify-start border-l border-[#a8842f] bg-[#C9A24A]" style={{ transform: shut ? "none" : "translateX(101%)", transition: ease }}>
        <span className="ml-1 font-display text-5xl font-extrabold italic text-white">C</span>
      </div>
      <div
        className="absolute inset-x-0 bottom-[30%] text-center font-mono text-sm font-bold uppercase tracking-widest text-[#14213D]"
        style={{ opacity: shut ? 1 : 0, transition: "opacity .3s ease .25s" }}
      >
        {greeting()}
        {name ? `, ${name}` : ""}
      </div>
    </div>
  );
}
