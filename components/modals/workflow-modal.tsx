"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TaggedWorkflow, TaggedExecution } from "@/lib/use-n8n-poller";
import type { FailedExecution } from "@/components/failure-alerts";
import { Modal } from "./modal";

type SortKey =
  | "instance"
  | "name"
  | "runs"
  | "failed"
  | "lastrun"
  | "updated"
  | "created";
type ActiveFilter = "all" | "active" | "inactive";

// Name/instance read more naturally A→Z; everything else (counts, dates) you
// almost always want biggest/newest first.
function defaultDir(key: SortKey): "asc" | "desc" {
  return key === "name" || key === "instance" ? "asc" : "desc";
}

export function WorkflowModal({
  open,
  onClose,
  workflows,
  executions,
  failures,
  lastRunAt,
  onPickFromConnection,
}: {
  open: boolean;
  onClose: () => void;
  // All instances' workflows from the poller, tagged with their connection.
  workflows: TaggedWorkflow[] | null;
  // Recent executions across all instances — drives the run count.
  executions: TaggedExecution[];
  // Recent failed executions across all instances.
  failures: FailedExecution[];
  // Last-run timestamps, keyed `${connectionId}:${workflowId}`.
  lastRunAt: Record<string, string>;
  onPickFromConnection: (connectionId: string, workflowId: string, name: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "failed",
    dir: "desc",
  });

  // Reset the name filter each time the modal opens.
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  // Per-workflow counts, keyed `${connectionId}:${workflowId}`.
  const runCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of executions) {
      if (!e.workflowId) continue;
      const k = `${e.connectionId}:${e.workflowId}`;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [executions]);

  const failedCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of failures) {
      const k = `${f.connectionId}:${f.workflowId}`;
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [failures]);

  const visible = useMemo(() => {
    if (!workflows) return [];
    const q = filter.toLowerCase();
    const filtered = workflows
      .filter((w) => w.name.toLowerCase().includes(q))
      .filter((w) =>
        activeFilter === "all" ? true : activeFilter === "active" ? w.active : !w.active,
      );

    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (w: TaggedWorkflow): string | number => {
      const ck = `${w.connectionId}:${w.id}`;
      switch (sort.key) {
        case "instance":
          return w.connectionName.toLowerCase();
        case "name":
          return w.name.toLowerCase();
        case "runs":
          return runCounts[ck] ?? 0;
        case "failed":
          return failedCounts[ck] ?? 0;
        case "lastrun":
          return ts(lastRunAt[ck]);
        case "updated":
          return ts(w.updatedAt);
        case "created":
          return ts(w.createdAt);
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.name.localeCompare(b.name);
    });
  }, [workflows, filter, activeFilter, sort, runCounts, failedCounts, lastRunAt]);

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultDir(key) },
    );

  const loading = workflows === null;

  return (
    <Modal open={open} onClose={onClose} title="Load workflow to test" width={1180}>
      <div className="flex flex-col h-[560px] min-h-[300px]">
        <div className="flex flex-wrap gap-2 mb-3 items-center flex-shrink-0">
          <input
            type="text"
            placeholder={loading ? "Loading…" : "Filter by name…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={loading}
            className="flex-1 min-w-[180px] px-[10px] py-[8px] text-[13px] rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)]"
          />
          <FunnelMenu
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as ActiveFilter)}
            options={[
              { value: "active", label: "Active only" },
              { value: "inactive", label: "Inactive only" },
              { value: "all", label: "All workflows" },
            ]}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-auto thin-scroll border border-[var(--border)] rounded-md">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10 bg-[var(--panel-soft)]">
              <tr className="text-[var(--muted)]">
                <Th label="Instance" k="instance" sort={sort} onSort={onSort} />
                <Th label="Workflow" k="name" sort={sort} onSort={onSort} />
                <Th label="Runs" k="runs" sort={sort} onSort={onSort} align="right" />
                <Th label="Failed" k="failed" sort={sort} onSort={onSort} align="right" />
                <Th label="Last run" k="lastrun" sort={sort} onSort={onSort} />
                <Th label="Updated" k="updated" sort={sort} onSort={onSort} />
                <Th label="Created" k="created" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {visible.map((wf) => {
                const ck = `${wf.connectionId}:${wf.id}`;
                const runs = runCounts[ck] ?? 0;
                const failed = failedCounts[ck] ?? 0;
                const lastRun = lastRunAt[ck];
                return (
                  <tr
                    key={ck}
                    onClick={() => onPickFromConnection(wf.connectionId, wf.id, wf.name)}
                    className="border-t border-[var(--border)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--n8n)_8%,transparent)]"
                  >
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap">
                      {wf.connectionName}
                    </td>
                    <td className="px-3 py-2 max-w-[340px]">
                      <div className="font-semibold text-[13px] truncate" title={wf.name}>
                        {wf.name}
                      </div>
                      {!wf.active && (
                        <span className="text-[10px] text-[var(--muted-2)] uppercase tracking-[0.5px]">
                          inactive
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--muted)]">
                      {runs || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {failed > 0 ? (
                        <span className="px-1.5 py-0.5 rounded-full bg-[var(--red-bg)] text-[var(--red-text)]">
                          {failed}
                        </span>
                      ) : (
                        <span className="text-[var(--muted-2)]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap font-mono">
                      {lastRun ? fmtRelative(lastRun) : "never"}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap font-mono">
                      {wf.updatedAt ? fmtDate(wf.updatedAt) : "—"}
                    </td>
                    <td className="px-3 py-2 text-[var(--muted)] whitespace-nowrap font-mono">
                      {wf.createdAt ? fmtDate(wf.createdAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && visible.length === 0 && (
            <div className="text-[13px] text-[var(--muted)] px-2 py-6 text-center">
              No workflows match.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
  align,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (k: SortKey) => void;
  align?: "right";
}) {
  const active = sort.key === k;
  return (
    <th
      onClick={() => onSort(k)}
      className={`px-3 py-2 font-semibold uppercase tracking-[0.5px] text-[10px] cursor-pointer select-none whitespace-nowrap hover:text-[var(--text)] ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-[var(--text)]" : ""}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        <span className="text-[var(--n8n)] w-2">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </span>
    </th>
  );
}

function FunnelMenu<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Highlight the trigger when something other than the default ("active") is set,
  // so the user always sees that a filter is on.
  const active = value !== "active";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Filter"
        aria-label="Filter"
        className={`w-[34px] h-[34px] rounded-[5px] border flex items-center justify-center cursor-pointer ${
          active
            ? "bg-[var(--n8n)] text-white border-[var(--n8n)]"
            : "bg-[var(--panel)] text-[var(--text)] border-[var(--border-strong)] hover:brightness-95"
        }`}
      >
        <FunnelIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[40px] min-w-[180px] bg-[var(--panel)] border border-[var(--border)] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.15)] z-[200] py-1"
        >
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left flex items-center gap-2 px-3 py-[7px] text-[13px] cursor-pointer border-0 bg-transparent ${
                  selected ? "text-[var(--n8n)] font-medium" : "text-[var(--text)]"
                } hover:bg-[var(--panel-soft)]`}
              >
                <span className="w-[14px] text-center">{selected ? "✓" : ""}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FunnelIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-[16px] h-[16px]"
    >
      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4z" />
    </svg>
  );
}

function ts(d?: string): number {
  return d ? Date.parse(d) || 0 : 0;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// "3 min ago", "2 hr ago", "5 days ago", "3 weeks ago" — for last-run times.
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
  const yr = Math.round(mo / 12);
  return `${yr} yr ago`;
}
