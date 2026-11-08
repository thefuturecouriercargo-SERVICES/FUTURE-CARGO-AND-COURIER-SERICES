"use client";

import { useEffect } from "react";
import { installIOSDownloadFix } from "@/lib/savePdf";

/** iPhone: PDF/Excel export links open the share sheet (save/share) instead of only viewing. */
export default function IOSDownloadFix() {
  useEffect(() => installIOSDownloadFix(), []);
  return null;
}
