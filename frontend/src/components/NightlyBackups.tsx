"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/Feedback";

interface NightlyStatus {
  configured: boolean;
  keepDays?: number;
  files: { key: string; date: string; sizeKb: number; savedAt: string }[];
  lastFailure: { at: string; meta: { error?: string } | null } | null;
}

function fmtDay(d: string) {
  return d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
}

/** Settings → list of the automatic nightly backups kept in the storage bucket. */
export default function NightlyBackups() {
  const [st, setSt] = useState<NightlyStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = () =>
    apiFetch<NightlyStatus>("/settings/backup/nightly")
      .then(setSt)
      .catch((e) => setSt({ configured: true, files: [], lastFailure: { at: new Date().toISOString(), meta: { error: e instanceof Error ? e.message : "Could not reach storage" } } }));

  useEffect(() => {
    load();
  }, []);

  async function runNow() {
    setRunning(true);
    try {
      const r = await apiFetch<{ date: string; sizeKb: number }>("/settings/backup/nightly/run", { method: "POST" });
      toast("Backup saved", "success", `${fmtDay(r.date)} · ${r.sizeKb} KB`);
      load();
    } catch (e) {
      toast("Backup failed", "error", e instanceof Error ? e.message : undefined);
    } finally {
      setRunning(false);
    }
  }

  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  const latest = st?.files[0];
  const ok = latest && (latest.date === today || Date.now() - new Date(latest.savedAt).getTime() < 30 * 3600 * 1000);
  const shown = showAll ? st?.files ?? [] : (st?.files ?? []).slice(0, 7);

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="mb-2 font-mono text-[11px] uppercase tracking-widest text-brass">Nightly automatic backup</h3>
      {!st ? (
        <p className="text-sm text-ink-soft">Loading…</p>
      ) : !st.configured ? (
        <p className="text-sm text-ink-soft">
          <span className="text-cancelled">● Not set up.</span> The backup storage variables (BACKUP_S3_*) are missing on the backend service.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {ok ? <span className="text-delivered">● Active</span> : <span className="text-pending">● Waiting for first backup</span>} — every night after 3 AM (Dubai), saved
            separately from the database. Last {st.keepDays ?? 60} days are kept.
          </p>
          {st.lastFailure && (
            <p className="mt-2 rounded bg-cancelled-bg px-3 py-2 text-xs text-cancelled">
              Last attempt failed ({new Date(st.lastFailure.at).toLocaleString("en-GB")}): {st.lastFailure.meta?.error ?? "unknown error"}
            </p>
          )}

          {st.files.length > 0 && (
            <ul className="mt-3 divide-y divide-line border border-line">
              {shown.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span>
                    {fmtDay(f.date)} <span className="text-xs text-ink-soft">· {f.sizeKb} KB</span>
                  </span>
                  <a href={`/api/settings/backup/nightly/download?key=${encodeURIComponent(f.key)}`} className="font-mono text-xs uppercase text-brass hover:underline">
                    ⬇ Download
                  </a>
                </li>
              ))}
            </ul>
          )}
          {st.files.length > 7 && (
            <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-brass hover:underline">
              {showAll ? "Show fewer" : `Show all ${st.files.length}`}
            </button>
          )}

          <button
            type="button"
            onClick={runNow}
            disabled={running}
            className="mt-3 block rounded border border-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-navy hover:bg-paper-2 disabled:opacity-50"
          >
            {running ? "Backing up…" : "Back up now"}
          </button>
          <p className="mt-2 text-xs text-ink-soft">Files are .json.gz — unzip to get the same JSON as “Download Backup”.</p>
        </>
      )}
    </div>
  );
}
