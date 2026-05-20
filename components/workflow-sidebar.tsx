"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, N8nWorkflowSummary } from "@/lib/types";
import { apiListWorkflows, readTestCounts } from "@/lib/client";

const COLLAPSED_KEY = "n8n-ft.sidebar.collapsed";
const ACTIVE_KEY = "n8n-ft.sidebar.activeOnly";
const SORT_KEY = "n8n-ft.sidebar.sort";

type Sort = "usage" | "name" | "updated" | "created";
const SORT_OPTIONS: Array<{ value: Sort; label: string }> = [
  { value: "usage", label: "Most used" },
  { value: "name", label: "Name (A→Z)" },
  { value: "updated", label: "Recently edited" },
  { value: "created", label: "Recently created" },
];

export function WorkflowSidebar({
  settings,
  currentId,
  onPick,
  refreshTick,
}: {
  settings: AppSettings;
  currentId: string | null;
  onPick: (id: string, name: string) => void;
  // Bump to force a workflow-list refresh (e.g. after settings change).
  refreshTick?: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [sort, setSort] = useState<Sort>("updated");
  const [filter, setFilter] = useState("");
  const [workflows, setWorkflows] = useState<N8nWorkflowSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      setActiveOnly(localStorage.getItem(ACTIVE_KEY) !== "0");
      const s = localStorage.getItem(SORT_KEY) as Sort | null;
      if (s && SORT_OPTIONS.some((o) => o.value === s)) setSort(s);
    } catch {}
  }, []);

  useEffect(() => {
    setCounts(readTestCounts());
    if (!settings.n8nUrl || !settings.apiKey) {
      setWorkflows(null);
      setError("Add n8n URL and API key in Settings.");
      return;
    }
    setLoading(true);
    setError(null);
    apiListWorkflows(settings)
      .then((wf) => setWorkflows(wf))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [settings, refreshTick]);

  // Refresh tested-count badge each time the loaded workflow changes —
  // bumpTestCount fires on pick, and we want the sidebar count to reflect it.
  useEffect(() => {
    setCounts(readTestCounts());
  }, [currentId]);

  const visible = useMemo(() => {
    if (!workflows) return [];
    const q = filter.toLowerCase();
    const filtered = workflows
      .filter((w) => (activeOnly ? w.active : true))
      .filter((w) => w.name.toLowerCase().includes(q));
    const sorted = [...filtered].sort((a, b) => {
      switch (sort) {
        case "usage": {
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
  }, [workflows, filter, activeOnly, sort, counts]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
    } catch {}
  };

  const toggleActive = () => {
    const next = !activeOnly;
    setActiveOnly(next);
    try {
      localStorage.setItem(ACTIVE_KEY, next ? "1" : "0");
    } catch {}
  };

  const changeSort = (next: Sort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {}
  };

  if (collapsed) {
    return (
      <aside className="flex-shrink-0 w-9 border-r border-[var(--border)] bg-[var(--panel-soft)] flex flex-col items-center pt-2 sticky top-0 self-start h-screen max-h-screen overflow-hidden">
        <button
          type="button"
          onClick={toggle}
          title="Expand workflows sidebar"
          aria-label="Expand workflows sidebar"
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] cursor-pointer"
        >
          <Chevron dir="right" />
        </button>
        <div
          className="mt-3 text-[10px] tracking-[2px] text-[var(--muted-2)] font-semibold"
          style={{ writingMode: "vertical-rl" }}
        >
          WORKFLOWS
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex-shrink-0 w-[260px] border-r border-[var(--border)] bg-[var(--panel-soft)] flex flex-col sticky top-0 self-start h-screen max-h-screen overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-[var(--border)]">
        <div className="text-[11px] font-semibold tracking-[1px] uppercase text-[var(--muted)] flex-1">
          Workflows
        </div>
        <button
          type="button"
          onClick={toggleActive}
          title={activeOnly ? "Showing active only — click to show all" : "Showing all — click to show active only"}
          className={`text-[10px] font-medium px-1.5 py-[2px] rounded border cursor-pointer ${
            activeOnly
              ? "bg-[var(--n8n)] text-white border-[var(--n8n)]"
              : "bg-transparent text-[var(--muted)] border-[var(--border-strong)]"
          }`}
        >
          {activeOnly ? "active" : "all"}
        </button>
        <button
          type="button"
          onClick={toggle}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] cursor-pointer"
        >
          <Chevron dir="left" />
        </button>
      </div>

      <div className="px-2 pt-2 flex items-center gap-1">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={loading ? "Loading…" : "Filter…"}
          className="flex-1 min-w-0 px-2 py-1 text-[12px] rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)]"
        />
        <SortMenu value={sort} onChange={changeSort} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-[50vh]">
        {error && (
          <div className="text-[11px] text-[var(--red-text)] bg-[var(--red-bg)] px-2 py-1.5 rounded">
            {error}
          </div>
        )}
        {!error && visible.map((wf) => {
          const selected = wf.id === currentId;
          return (
            <button
              key={wf.id}
              type="button"
              onClick={() => onPick(wf.id, wf.name)}
              title={wf.name}
              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded mb-1 text-[12px] cursor-pointer border ${
                selected
                  ? "bg-[color-mix(in_srgb,var(--n8n)_15%,transparent)] border-[var(--n8n)] text-[var(--text)] font-semibold"
                  : "bg-transparent border-transparent text-[var(--text)] hover:bg-[var(--bg)] hover:border-[var(--border)]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wf.active ? "bg-[#059669]" : "bg-[var(--muted-2)]"}`}
                aria-hidden
              />
              <span className="flex-1 truncate">{wf.name}</span>
            </button>
          );
        })}
        {!loading && !error && workflows && visible.length === 0 && (
          <div className="text-[11px] text-[var(--muted)] px-2 py-3 text-center">
            No workflows match.
          </div>
        )}
      </div>
    </aside>
  );
}

function ts(d?: string): number {
  return d ? Date.parse(d) || 0 : 0;
}

function SortMenu({
  value,
  onChange,
}: {
  value: Sort;
  onChange: (v: Sort) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = SORT_OPTIONS.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Sort: ${current?.label ?? value}`}
        aria-label="Sort workflows"
        className="w-7 h-7 rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center cursor-pointer flex-shrink-0"
      >
        <SortIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[32px] min-w-[170px] bg-[var(--panel)] border border-[var(--border)] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.15)] z-[200] py-1"
        >
          {SORT_OPTIONS.map((opt) => {
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
                className={`w-full text-left flex items-center gap-2 px-3 py-[6px] text-[12px] cursor-pointer border-0 bg-transparent ${
                  selected ? "text-[var(--n8n)] font-medium" : "text-[var(--text)]"
                } hover:bg-[var(--panel-soft)]`}
              >
                <span className="w-[12px] text-center">{selected ? "✓" : ""}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden
    >
      <line x1="4" y1="6" x2="14" y2="6" />
      <line x1="4" y1="12" x2="11" y2="12" />
      <line x1="4" y1="18" x2="8" y2="18" />
      <polyline points="17 9 20 6 17 3" opacity="0" />
      <line x1="18" y1="4" x2="18" y2="20" />
      <polyline points="15 17 18 20 21 17" />
    </svg>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden
    >
      {dir === "left" ? (
        <polyline points="15 6 9 12 15 18" />
      ) : (
        <polyline points="9 6 15 12 9 18" />
      )}
    </svg>
  );
}
