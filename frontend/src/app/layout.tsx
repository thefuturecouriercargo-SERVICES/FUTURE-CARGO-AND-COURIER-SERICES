import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Future Courier — Operations",
  description: "Delivery management system for The Future Courier Service L.L.C",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  // Makes "Add to Home Screen" on iOS behave like a real app (own status bar,
  // no Safari address bar) — iOS reads these meta tags, not the web manifest.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Future Courier",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  // Lets the app draw content behind the iPhone's notch/status bar and home
  // indicator, so the safe-area-inset-* CSS variables below actually activate —
  // without this, iOS just adds blank white bars instead.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
