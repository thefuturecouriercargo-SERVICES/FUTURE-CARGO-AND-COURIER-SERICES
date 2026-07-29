"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
  createdAt: string;
  user?: { name: string; username: string } | null;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    apiFetch<{ logs: AuditLog[]; total: number }>("/audit-logs", { query: { limit: 200 } }).then((res) => {
      setLogs(res.logs);
      setTotal(res.total);
    });
  }, []);

  return (
    <div>
      <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-brass">Settings</p>
      <h1 className="mb-6 font-display text-3xl font-semibold text-navy">Audit Log</h1>
      <p className="mb-6 text-sm text-ink-soft">Every create, update, status change, transfer and cash closing is recorded here. Showing latest {logs.length} of {total}.</p>

      <div className="border border-line bg-white p-5">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="font-mono text-xs">{new Date(l.createdAt).toLocaleString()}</td>
                <td>{l.user?.name ?? "System"}</td>
                <td className="font-mono text-xs">{l.action}</td>
                <td>
                  {l.entity}
                  {l.entityId ? ` #${l.entityId.slice(-6)}` : ""}
                </td>
                <td className="max-w-md truncate text-xs text-ink-soft">{l.meta ? JSON.stringify(l.meta) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
