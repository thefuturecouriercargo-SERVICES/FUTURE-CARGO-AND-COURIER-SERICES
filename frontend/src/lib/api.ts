// Kept only for reference/back-compat — actual requests now go through the
// Next.js rewrite in next.config.js (see the note there for why: it makes the
// auth cookie first-party from the browser's point of view, which iPhone
// Safari's default privacy setting otherwise silently breaks).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

// Always relative (same-origin) — the browser only ever talks to the frontend's
// own domain, which Next.js then proxies server-side to the real backend.
function buildUrl(path: string, query?: RequestOptions["query"]) {
  const params = new URLSearchParams();
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== "") params.set(k, String(v));
    });
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
}

export async function apiFetch<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let details: unknown;
    try {
      const data = await res.json();
      message = data.error ?? message;
      details = data.details;
    } catch {
      /* ignore non-JSON error body */
    }
    throw new ApiClientError(res.status, message, details);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// Same relative-URL approach as buildUrl above, for the same Safari cookie reason.
function buildRelativeUrl(path: string, query?: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ""}`;
}

export function reportExportUrl(query: Record<string, string | undefined>) {
  return buildRelativeUrl("/reports/export", query);
}
export function employeePerformancePdfUrl(query: Record<string, string | undefined>) {
  return buildRelativeUrl("/reports/employee-performance/pdf", query);
}

export function pnlExportUrl(query: Record<string, string | undefined>) {
  return buildRelativeUrl("/reports/pnl", query);
}

export function expenseReportUrl(query: Record<string, string | undefined>) {
  return buildRelativeUrl("/reports/expenses/export", query);
}

export function vendorCreditExportUrl(query: Record<string, string | undefined>) {
  return buildRelativeUrl("/vendor-credit/export", query);
}

export function agentCreditExportUrl() {
  return buildRelativeUrl("/agent-credit/export");
}

export function settingsBackupUrl() {
  return buildRelativeUrl("/settings/backup");
}

export { API_URL };
