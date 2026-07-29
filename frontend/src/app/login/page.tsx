"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, ApiClientError } from "@/context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      router.push(user.role === "SUPER_ADMIN" ? "/dashboard" : "/driver");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded border border-line bg-white p-8 shadow-sm">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Operations</p>
        <h1 className="mb-1 font-display text-2xl font-semibold text-navy">Future Courier</h1>
        <p className="mb-8 text-sm text-ink-soft">Sign in to the delivery management system.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-ink-soft">
              Username or email
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-brass"
              placeholder="admin"
              required
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-[11px] uppercase tracking-wide text-ink-soft">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-line px-3 py-2 text-sm outline-none focus:border-brass"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="rounded bg-cancelled-bg px-3 py-2 text-xs text-cancelled">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-navy py-2.5 font-mono text-xs font-semibold uppercase tracking-widest text-paper transition hover:bg-navy-2 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-soft">
          Drivers: use the username your admin created for you (e.g. your first name).
        </p>
      </div>
    </div>
  );
}
