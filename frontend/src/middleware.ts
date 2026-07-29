import { NextRequest, NextResponse } from "next/server";

// Lightweight, edge-safe gate: only checks whether the auth cookie is present
// (it cannot verify the JWT signature here without extra edge-compatible
// crypto libraries). Real authorization is always enforced by the API.
// This just avoids a flash of protected UI before the client-side AuthGate
// redirects.
const COOKIE_NAME = process.env.COOKIE_NAME ?? "fc_token";
const PROTECTED_PREFIXES = ["/dashboard", "/orders", "/employees", "/vendors", "/reports", "/settings", "/audit-log", "/driver"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasToken = Boolean(req.cookies.get(COOKIE_NAME)?.value);

  if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) && !hasToken) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && hasToken) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/orders/:path*", "/employees/:path*", "/vendors/:path*", "/reports/:path*", "/settings/:path*", "/audit-log/:path*", "/driver/:path*", "/login"],
};
