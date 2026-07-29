"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface CompanySettings {
  id: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    apiFetch<CompanySettings>("/settings/company").then(setSettings);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const updated = await apiFetch<CompanySettings>("/settings/company", {
      method: "PUT",
      body: { name: settings.name, address: settings.address, phone: settings.phone, email: settings.email, logoUrl: settings.logoUrl },
    });
    setSettings(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Company Profile</h1>

      {settings && (
        <form onSubmit={onSubmit} className="mb-8 max-w-xl border border-line bg-white p-6">
          <div className="mb-4">
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Company name</label>
            <input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div className="mb-4">
            <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Address</label>
            <input value={settings.address ?? ""} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Phone</label>
              <input value={settings.phone ?? ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase text-ink-soft">Email</label>
              <input value={settings.email ?? ""} onChange={(e) => setSettings({ ...settings, email: e.target.value })} className="w-full rounded border border-line px-2.5 py-2 text-sm" />
            </div>
          </div>
          <button type="submit" className="rounded bg-navy px-4 py-2 font-mono text-xs uppercase tracking-wide text-paper hover:bg-navy-2">
            Save
          </button>
          {saved && <span className="ml-3 text-xs text-delivered">Saved.</span>}
        </form>
      )}

      <div className="max-w-xl border border-line bg-white p-6">
        <h2 className="mb-3 font-display text-[17px] font-semibold text-navy">Appearance</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          Dark mode (this browser only)
        </label>
      </div>

      <div className="mt-8 max-w-xl border border-line bg-white p-6">
        <h2 className="mb-3 font-display text-[17px] font-semibold text-navy">Backup &amp; Restore</h2>
        <p className="text-sm text-ink-soft">
          Data lives in PostgreSQL. Use the standard Postgres tools for backups: <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-xs">pg_dump</code> to
          export a full backup and <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-xs">pg_restore</code> / <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-xs">psql</code> to
          restore it. See the project README for ready-to-run commands, including a scheduled backup example for the Docker deployment.
        </p>
      </div>
    </div>
  );
}
