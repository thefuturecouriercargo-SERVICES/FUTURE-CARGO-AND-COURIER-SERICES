/** Line icons for the driver home boxes (soft tint square style). */
const P: Record<string, React.ReactNode> = {
  assign: (
    <>
      <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
      <path d="M8 8v8M11 8v8M14 8v8M17 8v8" />
    </>
  ),
  deliveries: (
    <>
      <path d="M2 7a1 1 0 011-1h10a1 1 0 011 1v10H3a1 1 0 01-1-1z" />
      <path d="M14 10h4l3 3.5V17h-7z" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  area: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.6" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.8" />
      <path d="M6 9.5v.01M18 14.5v.01" />
    </>
  ),
  returns: (
    <>
      <path d="M20 7l-8-4-8 4v10l8 4 8-4z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
      <path d="M15.5 14.5H9.5m0 0l2-2m-2 2l2 2" />
    </>
  ),
  targets: (
    <>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 01-10 0z" />
      <path d="M7 6H4.5v1A3 3 0 007 10M17 6h2.5v1A3 3 0 0117 10" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 102.5-6L3.5 8.5" />
      <path d="M3.5 3.5v5h5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  fuel: (
    <>
      <path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16M3 21h13" />
      <path d="M7 7h5v4H7zM15 9h2a2 2 0 012 2v5a1.5 1.5 0 003 0V8l-3-3" />
    </>
  ),
  payroll: (
    <>
      <path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7.5h6M9 11h6M9 14.5h3.5" />
    </>
  ),
};

export type DriverIconName = "assign" | "deliveries" | "area" | "cash" | "returns" | "targets" | "history" | "payroll" | "fuel";

export default function DriverIcon({ name, size = 22 }: { name: DriverIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
