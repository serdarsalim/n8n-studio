"use client";
import { useMemo, useState } from "react";
import type { TaggedWorkflow, TaggedExecution } from "@/lib/use-n8n-poller";
import type { FailedExecution } from "@/components/failure-alerts";

// The mobile counterpart to WorkflowModal. Same data, but instead of a wide
// sortable table with a dedicated Instance column, we drop the sidebar entirely
// on phones and let this be the "Load" tab: group rows under instance headers,
// keep only the columns a thumb-sized screen can show — name, last run, failed.
export function WorkflowPickerMobile({
  workflows,
  executions,
  failures,
  lastRunAt,
  currentId,
  onPick,
}: {
  workflows: TaggedWorkflow[] | null;
  executions: TaggedExecution[];
  failures: FailedExecution[];
  lastRunAt: Record<string, string>;
  currentId: string | null;
  onPick: (connectionId: string, workflowId: string, name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const failedCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of failures) {
      const k = `${f.connectionId}:${f.workflowId}`;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [failures]);

  // Group visible workflows under their instance. Instances are ordered by
  // first appearance; within an instance, failing workflows float up, then
  // most-recently-run, then name.
  const groups = useMemo(() => {
    if (!workflows) return [];
    const q = filter.toLowerCase();
    const filtered = workflows
      .filter((w) => w.name.toLowerCase().includes(q))
      .filter((w) => (activeOnly ? w.active : true));

    const order: string[] = [];
    const byConn: Record<string, { name: string; rows: TaggedWorkflow[] }> = {};
    for (const w of filtered) {
      if (!byConn[w.connectionId]) {
        byConn[w.connectionId] = { name: w.connectionName, rows: [] };
        order.push(w.connectionId);
      }
      byConn[w.connectionId].rows.push(w);
    }

    return order.map((connId) => {
      const g = byConn[connId];
      const rows = [...g.rows].sort((a, b) => {
        const fa = failedCounts[`${a.connectionId}:${a.id}`] ?? 0;
        const fb = failedCounts[`${b.connectionId}:${b.id}`] ?? 0;
        if (fa !== fb) return fb - fa;
        const la = ts(lastRunAt[`${a.connectionId}:${a.id}`]);
        const lb = ts(lastRunAt[`${b.connectionId}:${b.id}`]);
        if (la !== lb) return lb - la;
        return a.name.localeCompare(b.name);
      });
      return { connId, name: g.name, rows };
    });
  }, [workflows, filter, activeOnly, failedCounts, lastRunAt]);

  const loading = workflows === null;
  const empty = !loading && groups.every((g) => g.rows.length === 0);

  return (
    <div className="flex flex-col">
      <div className="flex gap-2 mb-3 items-center sticky top-0 z-20 bg-[var(--panel)] py-1">
        <input
          type="text"
          placeholder={loading ? "Loading…" : "Filter by name…"}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          disabled={loading}
          className="flex-1 min-w-0 px-[10px] py-[9px] text-[14px] rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)]"
        />
        <button
          type="button"
          onClick={() => setActiveOnly((v) => !v)}
          className={`flex-shrink-0 px-3 py-[9px] text-[12px] font-medium rounded-[5px] border cursor-pointer ${
            activeOnly
              ? "bg-[var(--n8n)] text-white border-[var(--n8n)]"
              : "bg-[var(--panel)] text-[var(--text)] border-[var(--border-strong)]"
          }`}
        >
          {activeOnly ? "Active" : "All"}
        </button>
      </div>

      <div className="-mx-1 px-1">
        {empty && (
          <div className="text-[13px] text-[var(--muted)] px-2 py-8 text-center">
            {filter ? "No workflows match." : "No workflows found."}
          </div>
        )}
        {groups.map((g) =>
          g.rows.length === 0 ? null : (
            <div key={g.connId} className="mb-4">
              <div className="px-1 pb-1.5 pt-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.6px] text-[var(--muted)]">
                  {g.name}
                </span>
              </div>
              <div className="flex flex-col rounded-md border border-[var(--border)] overflow-hidden">
                {g.rows.map((wf) => {
                  const ck = `${wf.connectionId}:${wf.id}`;
                  const failed = failedCounts[ck] ?? 0;
                  const lastRun = lastRunAt[ck];
                  const selected = wf.id === currentId;
                  return (
                    <button
                      key={ck}
                      type="button"
                      onClick={() => onPick(wf.connectionId, wf.id, wf.name)}
                      className={`flex items-center gap-3 px-3 py-3 text-left border-t border-[var(--border)] first:border-t-0 active:bg-[color-mix(in_srgb,var(--n8n)_12%,transparent)] ${
                        selected
                          ? "bg-[color-mix(in_srgb,var(--n8n)_10%,transparent)]"
                          : "bg-[var(--panel)]"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[14px] text-[var(--text)] truncate">
                          {wf.name}
                        </div>
                        <div className="text-[11px] text-[var(--muted)] font-mono mt-0.5">
                          {lastRun ? fmtRelative(lastRun) : "never run"}
                          {!wf.active && (
                            <span className="ml-2 uppercase tracking-[0.5px] text-[var(--muted-2)]">
                              inactive
                            </span>
                          )}
                        </div>
                      </div>
                      {failed > 0 && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-mono bg-[var(--red-bg)] text-[var(--red-text)]">
                          {failed} failed
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function ts(d?: string): number {
  return d ? Date.parse(d) || 0 : 0;
}

// "3 min ago", "2 hr ago", "5 days ago" — matches WorkflowModal's phrasing.
function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk} week${wk === 1 ? "" : "s"} ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo} mon ago`;
  return `${Math.round(mo / 12)} yr ago`;
}
