/**
 * Line icons used across the app in place of emoji — same stroke style as
 * the driver home icons. Inherits colour from the text (currentColor) and
 * sits inline with text; size defaults to 1em.
 */
const P = {
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  scan: (
    <>
      <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3" />
      <path d="M8 8v8M11 8v8M14 8v8M17 8v8" />
    </>
  ),
  flashlight: (
    <>
      <path d="M18 6c0 2-2 2-2 4v10a2 2 0 01-2 2h-4a2 2 0 01-2-2V10c0-2-2-2-2-4V2h12z" />
      <path d="M6 6h12M12 12v1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="M21 21l-4.6-4.6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 01-14 0v-1M12 18v4" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.9.7 2.8a2 2 0 01-.5 2.1L8.1 9.9a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.9.6 2.8.7a2 2 0 011.7 2z" />
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.6" />
    </>
  ),
  printer: (
    <>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  save: (
    <>
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M5.3 5.3l13.4 13.4" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 003.4 0" />
    </>
  ),
  bellOff: (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 003.4 0M2 2l20 20" />
    </>
  ),
  mosque: (
    <>
      <path d="M2 21h20" />
      <path d="M6 21v-6a6 6 0 0112 0v6" />
      <path d="M12 9V5.5M10.6 6.5L12 5l1.4 1.5" />
      <path d="M10 21v-3a2 2 0 014 0v3" />
      <path d="M3.5 21V11M20.5 21V11" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v5a5 5 0 01-10 0z" />
      <path d="M7 6H4.5v1A3 3 0 007 10M17 6h2.5v1A3 3 0 0117 10" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="6" />
      <path d="M8.5 9.6L6 2h4l2 5 2-5h4l-2.5 7.6" />
    </>
  ),
  share: (
    <>
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
      <path d="M16 6l-4-4-4 4M12 2v13" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </>
  ),
  message: <path d="M7.9 20A9 9 0 104 16.1L2 22z" />,
  truck: (
    <>
      <path d="M2 7a1 1 0 011-1h10a1 1 0 011 1v10H3a1 1 0 01-1-1z" />
      <path d="M14 10h4l3 3.5V17h-7z" />
      <circle cx="7" cy="17.5" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </>
  ),
  card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  home: (
    <>
      <path d="M3 10l9-7 9 7v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <path d="M9 22V12h6v10" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H17a3.5 3.5 0 000-7H7a3.5 3.5 0 010-7h8.5" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7z" />
      <path d="M14 2v5h5M9 13h6M9 17h6" />
    </>
  ),
  note: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5a14.5 14.5 0 010 19M12 2.5a14.5 14.5 0 000 19" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0116 0" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.8 4H7.2a2 2 0 00-1.7 1.1z" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
    </>
  ),
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 3v4M17 5h4" />
    </>
  ),
  hourglass: (
    <path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 00-.6-1.4L12 12l-4.4 4.4a2 2 0 00-.6 1.4V22M7 2v4.2a2 2 0 00.6 1.4L12 12l4.4-4.4a2 2 0 00.6-1.4V2" />
  ),
  star: <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />,
  pen: (
    <>
      <path d="M17 3a2.8 2.8 0 014 4L7.5 20.5 2 22l1.5-5.5z" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  minus: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />,
};

export type IconName = keyof typeof P;

export default function Icon({ name, size = "1.1em", className, strokeWidth = 2 }: { name: IconName; size?: number | string; className?: string; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`inline-block shrink-0 align-[-0.18em] ${className ?? ""}`}
    >
      {P[name]}
    </svg>
  );
}
