import { NextResponse } from "next/server";
import { RELEASE_NOTES } from "@/lib/releaseNotes";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID || "", notes: RELEASE_NOTES },
    { headers: { "Cache-Control": "no-store" } }
  );
}
