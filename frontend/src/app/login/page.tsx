"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, ApiClientError } from "@/context/AuthContext";

import AuthSplit from "@/components/AuthSplit";
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
    <AuthSplit eyebrow="Operations">
      <div className="rounded-[22px] border border-line bg-white p-7 shadow-2xl shadow-black/40 sm:p-8">
        <h2 className="font-display text-2xl font-semibold text-white">Welcome back</h2>
        <p className="mb-7 mt-1 text-sm text-ink-soft">Sign in to the delivery management system.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-user" className="mb-1.5 block text-xs font-medium text-ink-soft">
              Username or email
            </label>
            <input
              id="login-user"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-12 w-full rounded-xl border border-line px-3.5 text-[15px] outline-none focus:border-brass"
              placeholder="admin"
              required
            />
          </div>
          <div>
            <label htmlFor="login-pass" className="mb-1.5 block text-xs font-medium text-ink-soft">Password</label>
            <input
              id="login-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-line px-3.5 text-[15px] outline-none focus:border-brass"
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p className="rounded bg-cancelled-bg px-3 py-2 text-xs text-cancelled">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-navy py-3 text-sm font-semibold text-paper transition hover:bg-navy-2 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-ink-soft">
          Drivers: use the username your admin created for you (e.g. your first name).
        </p>
      </div>
    </AuthSplit>
  );
}
