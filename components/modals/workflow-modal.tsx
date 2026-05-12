"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, N8nWorkflowSummary } from "@/lib/types";
import { apiListWorkflows, readTestCounts } from "@/lib/client";
import { Modal } from "./modal";

type Sort = "tested" | "name" | "updated" | "created";
type ActiveFilter = "all" | "active" | "inactive";

export function WorkflowModal({
  open,
  onClose,
  settings,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onPick: (id: string, name: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [workflows, setWorkflows] = useState<N8nWorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>("tested");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!open) return;
    setCounts(readTestCounts());
    if (!settings.n8nUrl || !settings.apiKey) {
      setError("Set your n8n URL and API key in Settings first.");
      return;
    }
    setLoading(true);
    setError(null);
    apiListWorkflows(settings)
      .then((wf) => setWorkflows(wf))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, settings]);

  const visible = useMemo(() => {
    if (!workflows) return [];
    const filtered = workflows
      .filter((w) => w.name.toLowerCase().includes(filter.toLowerCase()))
      .filter((w) =>
        activeFilter === "all" ? true : activeFilter === "active" ? w.active : !w.active,
      );
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "tested": {
          const ca = counts[a.id] ?? 0;
          const cb = counts[b.id] ?? 0;
          if (cb !== ca) return cb - ca;
          return a.name.localeCompare(b.name);
        }
        case "name":
          return a.name.localeCompare(b.name);
        case "updated":
          return ts(b.updatedAt) - ts(a.updatedAt);
        case "created":
          return ts(b.createdAt) - ts(a.createdAt);
      }
    });
    return sorted;
  }, [workflows, filter, sort, activeFilter, counts]);

  return (
    <Modal open={open} onClose={onClose} title="Load workflow to test" wide>
      {error && (
        <div className="text-[13px] text-[var(--red-text)] bg-[var(--red-bg)] px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}
      {!error && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <input
            type="text"
            placeholder={loading ? "Loading…" : "Filter by name…"}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={loading || !workflows}
            className="flex-1 min-w-[180px] px-[10px] py-[8px] text-[13px] rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)]"
          />
          <Select value={sort} onChange={(v) => setSort(v as Sort)}>
            <option value="tested">Most tested</option>
            <option value="name">Name (A→Z)</option>
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
          </Select>
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
      )}
      <div className="h-[420px] min-h-[200px] overflow-y-auto">
        {visible.map((wf) => {
          const count = counts[wf.id] ?? 0;
          return (
            <button
              key={wf.id}
              type="button"
              onClick={() => onPick(wf.id, wf.name)}
              className="w-full text-left flex items-center gap-3 px-3 py-[10px] rounded-md border border-[var(--border)] mb-[6px] cursor-pointer bg-transparent hover:border-[var(--n8n)] hover:bg-[color-mix(in_srgb,var(--n8n)_8%,transparent)] last:mb-0"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px] truncate">{wf.name}</div>
                <div className="text-[11px] text-[var(--muted)] font-mono truncate">
                  {fmtMeta(wf)}
                </div>
              </div>
              {count > 0 && (
                <span className="text-[11px] text-[var(--muted)] font-mono whitespace-nowrap">
                  {count}× tested
                </span>
              )}
              <span className="text-[var(--muted-2)] text-[14px]">›</span>
            </button>
          );
        })}
        {!loading && !error && workflows && visible.length === 0 && (
          <div className="text-[13px] text-[var(--muted)] px-2 py-4 text-center">
            No workflows match.
          </div>
        )}
      </div>
    </Modal>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-[10px] py-[8px] text-[13px] rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)] cursor-pointer"
    >
      {children}
    </select>
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

function fmtMeta(wf: N8nWorkflowSummary): string {
  const parts: string[] = [];
  if (wf.updatedAt) parts.push(`updated ${fmtDate(wf.updatedAt)}`);
  if (wf.createdAt) parts.push(`created ${fmtDate(wf.createdAt)}`);
  return parts.join(" | ");
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
