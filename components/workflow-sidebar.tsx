"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppSettings, ConnectionsBlob } from "@/lib/types";
import { readPrefs, readTestCounts, type SidebarSort } from "@/lib/client";
import type { RefreshResult, TaggedWorkflow } from "@/lib/use-n8n-poller";

const COLLAPSED_KEY = "n8n-ft.sidebar.collapsed";
const ACTIVE_KEY = "n8n-ft.sidebar.activeOnly";
const SORT_KEY = "n8n-ft.sidebar.sort";
const WIDTH_KEY = "n8n-ft.sidebar.width";
const SELECTED_KEY = "n8n-ft.sidebar.selectedConnections";
const MIN_WIDTH = 180;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

const SORT_OPTIONS: Array<{ value: SidebarSort; label: string }> = [
  { value: "usage", label: "Most used" },
  { value: "name", label: "Name (A→Z)" },
  { value: "updated", label: "Recently edited" },
  { value: "created", label: "Recently created" },
  { value: "run", label: "Recently run" },
];

export function WorkflowSidebar({
  settings,
  connections,
  onSwitchConnection,
  currentId,
  onPick,
  onPickFromConnection,
  statusOverrides,
  workflows,
  lastStatus,
  lastRunAt,
  failedConnectionIds,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  settings: AppSettings;
  connections: ConnectionsBlob;
  onSwitchConnection: (id: string) => void;
  currentId: string | null;
  onPick: (id: string, name: string) => void;
  onPickFromConnection: (connectionId: string, workflowId: string, name: string) => void;
  // Per-workflow status overrides, used when the page already knows a
  // status (e.g. the currently-loaded execution) but the recent-executions
  // batch didn't include that workflow.
  statusOverrides?: Record<string, string>;
  // Data from the shared poller (lives in app/page.tsx).
  workflows: TaggedWorkflow[] | null;
  lastStatus: Record<string, string>;
  lastRunAt: Record<string, string>;
  failedConnectionIds: string[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => Promise<RefreshResult>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [sort, setSort] = useState<SidebarSort>("updated");
  const [filter, setFilter] = useState("");
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Which connections' workflows the list shows. This is a *display filter*
  // only — it never changes connections.activeId (the API target), which is
  // set when a workflow is actually picked. Empty is treated as "all".
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const allIds = useMemo(
    () => connections.connections.map((c) => c.id),
    [connections.connections],
  );
  // Fall back to "all" before the load effect runs (or if the set is empty)
  // so the list never flashes empty.
  const selForView = selectedIds.length ? selectedIds : allIds;
  const allSelected = allIds.length > 0 && selForView.length === allIds.length;
  // Grouped (per-connection headers) whenever more than one connection shows.
  const multi = selForView.length !== 1;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
      setActiveOnly(localStorage.getItem(ACTIVE_KEY) !== "0");
      const stored = localStorage.getItem(SORT_KEY) as SidebarSort | null;
      const valid = stored && SORT_OPTIONS.some((o) => o.value === stored);
      if (valid) {
        setSort(stored as SidebarSort);
      } else {
        // Fall back to the user-configured default from Settings.
        setSort(readPrefs().sidebarSortDefault);
      }
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(w) && w >= MIN_WIDTH && w <= MAX_WIDTH) setWidth(w);
    } catch {}
  }, []);

  // Drag-to-resize. Listeners live on window so the drag survives the
  // cursor leaving the 4px-wide handle.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      try {
        // Read latest width via state setter callback to avoid stale closure.
        setWidth((w) => {
          try {
            localStorage.setItem(WIDTH_KEY, String(w));
          } catch {}
          return w;
        });
      } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  // Auto-clear the toast after a moment.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  // Trigger a refresh via the shared poller and surface the outcome as a
  // toast. Spinner state lives on the poller (`refreshing` prop).
  const manualRefresh = async () => {
    try {
      const r = await onRefresh();
      if (!r.ok) {
        setToast({ kind: "err", text: "n8n didn't pick up. Try again?" });
        return;
      }
      const noun = r.workflowsCount === 1 ? "workflow" : "workflows";
      setToast({
        kind: "ok",
        text: r.changed
          ? `Refreshed · ${r.workflowsCount} ${noun} (updated)`
          : `Refreshed · ${r.workflowsCount} ${noun} (no changes)`,
      });
    } catch {
      setToast({ kind: "err", text: "n8n didn't pick up. Try again?" });
    }
  };

  // Refresh tested-count badge each time the loaded workflow changes —
  // bumpTestCount fires on pick, and we want the sidebar count to reflect it.
  useEffect(() => {
    setCounts(readTestCounts());
  }, [currentId]);

  // Load the persisted selection and reconcile it against the current set of
  // connections (drops ids for connections that no longer exist). Re-runs
  // when connections change. Reads storage as the source of truth so a user
  // toggle (which writes storage + state) is never clobbered by this effect.
  useEffect(() => {
    let stored: string[] | null = null;
    try {
      const raw = localStorage.getItem(SELECTED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) stored = parsed.filter((x) => typeof x === "string");
      }
    } catch {}
    const valid = (stored ?? allIds).filter((id) => allIds.includes(id));
    setSelectedIds(valid.length ? valid : allIds);
  }, [allIds]);

  const visible = useMemo(() => {
    if (!workflows) return [];
    const q = filter.toLowerCase();
    // Show only rows from the selected connections — the poller fetches
    // everything (so failure-alerts has all data) but the sidebar's view is
    // scoped to whatever connections are ticked in the picker.
    const sel = new Set(selForView);
    const scoped = workflows.filter((w) => sel.has(w.connectionId));
    const filtered = scoped
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
        case "run": {
          const ka = `${a.connectionId}:${a.id}`;
          const kb = `${b.connectionId}:${b.id}`;
          const ra = ts(lastRunAt[ka]);
          const rb = ts(lastRunAt[kb]);
          if (rb !== ra) return rb - ra;
          // Workflows that never ran fall to the bottom, sorted by name.
          return a.name.localeCompare(b.name);
        }
      }
    });
    return sorted;
  }, [workflows, filter, activeOnly, sort, counts, lastRunAt, selForView]);

  // When showing all, group rows under their connection name (preserving
  // sort within each group). In single mode this is just one flat group.
  const grouped: Array<{ connectionId: string; connectionName: string; rows: TaggedWorkflow[] }> = useMemo(() => {
    if (!multi) {
      const only = visible[0];
      if (only) {
        return [{ connectionId: only.connectionId, connectionName: only.connectionName, rows: visible }];
      }
      // No workflows for the sole selected connection. If it's the one that
      // just failed, still render a header so the user sees *which* instance
      // is down rather than an empty pane.
      const soleId = selForView[0];
      const sole = connections.connections.find((c) => c.id === soleId);
      if (sole && failedConnectionIds.includes(sole.id)) {
        return [{ connectionId: sole.id, connectionName: sole.name, rows: [] }];
      }
      return [];
    }
    // In multi mode, group order follows the connection order configured in
    // Settings — never the sort. Workflows shuffle within a group when the
    // user changes sort, but the group headers themselves stay put so you
    // don't lose your spot. Failed connections appear as empty groups so
    // they're never silently dropped. Only selected connections are shown.
    const sel = new Set(selForView);
    return connections.connections
      .filter((c) => sel.has(c.id))
      .map((c) => ({
        connectionId: c.id,
        connectionName: c.name,
        rows: visible.filter((w) => w.connectionId === c.id),
      }))
      .filter((g) => g.rows.length > 0 || failedConnectionIds.includes(g.connectionId));
  }, [visible, multi, selForView, connections.connections, failedConnectionIds]);

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

  const changeSort = (next: SidebarSort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {}
  };

  const persistSelected = (ids: string[]) => {
    setSelectedIds(ids);
    try {
      localStorage.setItem(SELECTED_KEY, JSON.stringify(ids));
    } catch {}
  };

  // Tick/untick one connection. Never lets the set go empty (the last one
  // stays) so the list is never blank.
  const toggleConnection = (id: string) => {
    const base = selForView;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    persistSelected(next.length ? next : [id]);
  };

  const selectAll = () => persistSelected(allIds);

  if (collapsed) {
    return (
      <aside className="app-pane flex-shrink-0 w-9 md:rounded-xl md:border md:border-[var(--border)] flex flex-col items-center pt-2 self-stretch h-full overflow-hidden">
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
          className="mt-3 text-[10px] tracking-[2px] font-semibold bg-gradient-to-b from-[var(--n8n)] to-[#7c3aed] bg-clip-text text-transparent"
          style={{ writingMode: "vertical-rl" }}
        >
          n8n STUDIO
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="app-pane flex-shrink-0 md:rounded-xl md:border md:border-[var(--border)] flex flex-col self-stretch h-full overflow-hidden relative"
      style={{ width }}
    >
      <div className="h-14 flex-shrink-0 pl-5 pr-3 flex items-center gap-2">
        <div className="flex-1">
          <span className="text-[13px] font-semibold tracking-[-0.01em] bg-gradient-to-r from-[var(--n8n)] to-[#7c3aed] bg-clip-text text-transparent">
            n8n studio
          </span>
        </div>
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

      {connections.connections.length > 0 && (
        <div className="px-2 pt-2 flex items-center gap-1">
          <div className="flex-1 min-w-0">
            <ConnectionPicker
              connections={connections}
              selectedIds={selForView}
              allSelected={allSelected}
              onToggle={toggleConnection}
              onSelectAll={selectAll}
            />
          </div>
          <button
            type="button"
            onClick={manualRefresh}
            disabled={loading || refreshing}
            title={loading || refreshing ? "Refreshing…" : "Refresh workflows"}
            aria-label="Refresh workflows"
            className="w-7 h-7 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] flex items-center justify-center cursor-pointer flex-shrink-0 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--muted)]"
          >
            <RefreshIcon spinning={loading || refreshing} />
          </button>
        </div>
      )}

      <div className="px-2 pt-2 flex items-center gap-1">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={loading ? "Loading…" : "Search"}
          className="flex-1 min-w-0 px-2 py-1 text-[12px] rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] outline-none focus:border-[var(--n8n)]"
        />
        <SortMenu
          value={sort}
          onChange={changeSort}
          activeOnly={activeOnly}
          onToggleActive={toggleActive}
        />
      </div>

      {toast && (
        <div
          aria-live="polite"
          className={`absolute left-1/2 -translate-x-1/2 top-[90px] z-20 px-3 py-1.5 text-[11px] font-medium rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.18)] pointer-events-none ${
            toast.kind === "ok"
              ? "bg-[var(--text)] text-[var(--panel)]"
              : "bg-[var(--red)] text-white"
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pt-2 pb-[50vh] [scrollbar-width:thin] [scrollbar-color:var(--border-strong)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--border-strong)] [&::-webkit-scrollbar-thumb]:rounded-full">
        {error && grouped.length === 0 && (
          <div className="text-[11px] text-[var(--red-text)] bg-[var(--red-bg)] px-2 py-1.5 rounded">
            {error}
          </div>
        )}
        {grouped.map((group) => {
          const failed = group.connectionId
            ? failedConnectionIds.includes(group.connectionId)
            : failedConnectionIds.includes(connections.activeId ?? "");
          const hasRows = group.rows.length > 0;
          return (
          <div key={group.connectionId || "single"} className="mb-2">
            {/* In single-connection mode the original UI didn't show a group
                header. We only inject one when the connection is down so the
                user knows *which* instance failed. */}
            {(multi || (!hasRows && failed)) && (
              <div className="px-2 pt-2 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--red-text)]">
                <span>{group.connectionName}</span>
                {failed && (
                  <span
                    className="normal-case tracking-normal font-normal text-[10px] text-[var(--red-text)] opacity-80"
                    title={hasRows ? "Couldn't reach this n8n. Showing what we last saw." : "This n8n is taking a nap. Or maybe it ran off."}
                  >
                    · {hasRows ? "showing last known list" : "took a nap"}
                  </span>
                )}
              </div>
            )}
            {failed && !hasRows && (
              <div className="mx-1 mb-1 text-[11px] text-[var(--muted)] px-2 py-2 italic">
                This n8n isn&apos;t picking up. Probably napping. Give it a poke?
              </div>
            )}
            {group.rows.map((wf) => {
              const key = `${wf.connectionId}:${wf.id}`;
              const selected =
                wf.id === currentId && wf.connectionId === connections.activeId;
              const status = statusOverrides?.[wf.id] ?? lastStatus[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPickFromConnection(wf.connectionId, wf.id, wf.name)}
                  title={wf.name}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded mb-1 text-[12px] cursor-pointer border ${
                    selected
                      ? "bg-[color-mix(in_srgb,var(--n8n)_15%,transparent)] border-[var(--n8n)] text-[var(--text)] font-semibold"
                      : "bg-transparent border-transparent text-[var(--text)] hover:bg-[var(--bg)] hover:border-[var(--border)]"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColorClass(status)}`}
                    aria-hidden
                    title={dotTitle(status)}
                  />
                  <span className="flex-1 truncate select-text">{wf.name}</span>
                </button>
              );
            })}
          </div>
          );
        })}
        {!loading && !error && workflows && visible.length === 0 && (
          <div className="text-[11px] text-[var(--muted)] px-2 py-3 text-center">
            No workflows match.
          </div>
        )}
      </div>
      {/* Resize handle: 4px-wide invisible strip on the right edge.
          Click-and-drag adjusts sidebar width; the surrounding `aside`
          uses `flex-shrink-0` so the main pane absorbs the change. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize"
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          try {
            localStorage.setItem(WIDTH_KEY, String(DEFAULT_WIDTH));
          } catch {}
        }}
        className={`absolute top-0 right-0 h-full w-[6px] -mr-[3px] cursor-col-resize z-10 ${
          dragging ? "bg-[var(--n8n)]/40" : "hover:bg-[var(--n8n)]/30"
        }`}
      />
    </aside>
  );
}

function dotColorClass(status: string | undefined): string {
  if (status === "success") return "bg-[#059669]";
  if (status === "error" || status === "canceled" || status === "crashed") return "bg-[#dc2626]";
  return "bg-[var(--muted-2)]";
}

function dotTitle(status: string | undefined): string {
  if (!status) return "Never run";
  if (status === "success") return "Last run: succeeded";
  if (status === "error") return "Last run: errored";
  if (status === "canceled") return "Last run: canceled";
  if (status === "running" || status === "waiting" || status === "new") return `Last run: ${status}`;
  return `Last run: ${status}`;
}

function ts(d?: string): number {
  return d ? Date.parse(d) || 0 : 0;
}

function ConnectionPicker({
  connections,
  selectedIds,
  allSelected,
  onToggle,
  onSelectAll,
}: {
  connections: ConnectionsBlob;
  selectedIds: string[];
  allSelected: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
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

  const total = connections.connections.length;
  const selSet = new Set(selectedIds);
  const label = allSelected
    ? "All connections"
    : selectedIds.length === 1
      ? (connections.connections.find((c) => c.id === selectedIds[0])?.name ?? "1 connection")
      : `${selectedIds.length} of ${total} connections`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        className="w-full flex items-center gap-1 px-1.5 py-1 rounded-md text-[14px] font-semibold text-[var(--text)] hover:bg-[var(--bg)] cursor-pointer bg-transparent border-0"
      >
        <span className="flex-1 truncate text-left">{label}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-4 h-4 text-[var(--muted)] flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-[34px] bg-[var(--panel)] border border-[var(--border)] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.15)] z-[200] py-1"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allSelected}
            onClick={onSelectAll}
            className="w-full text-left flex items-center gap-2 px-3 py-[6px] text-[12px] cursor-pointer border-0 bg-transparent text-[var(--text)] hover:bg-[var(--panel-soft)]"
          >
            <CheckBox checked={allSelected} />
            <span className="truncate font-medium">Show all ({total})</span>
          </button>
          {connections.connections.map((c) => {
            const checked = selSet.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onToggle(c.id)}
                className="w-full text-left flex items-center gap-2 px-3 py-[6px] text-[12px] cursor-pointer border-0 bg-transparent text-[var(--text)] hover:bg-[var(--panel-soft)]"
              >
                <CheckBox checked={checked} />
                <span className="truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center flex-shrink-0 ${
        checked
          ? "bg-[var(--n8n)] border-[var(--n8n)] text-white"
          : "border-[var(--border-strong)] text-transparent"
      }`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

function SortMenu({
  value,
  onChange,
  activeOnly,
  onToggleActive,
}: {
  value: SidebarSort;
  onChange: (v: SidebarSort) => void;
  activeOnly: boolean;
  onToggleActive: () => void;
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
          <div className="my-1 border-t border-[var(--border)]" />
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={activeOnly}
            onClick={onToggleActive}
            className="w-full text-left flex items-center gap-2 px-3 py-[6px] text-[12px] cursor-pointer border-0 bg-transparent text-[var(--text)] hover:bg-[var(--panel-soft)]"
          >
            <span className="w-[12px] text-center">{activeOnly ? "✓" : ""}</span>
            <span>Show active only</span>
          </button>
        </div>
      )}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
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
