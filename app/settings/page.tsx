"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Connection, ConnectionsBlob } from "@/lib/types";
import {
  type AppPrefs,
  DEFAULT_PREFS,
  newConnectionId,
  readConnections,
  readPrefs,
  type SidebarSort,
  writeConnections,
  writePrefs,
} from "@/lib/client";

const SORT_LABELS: Array<{ value: SidebarSort; label: string }> = [
  { value: "updated", label: "Recently edited" },
  { value: "created", label: "Recently created" },
  { value: "run", label: "Recently run" },
  { value: "usage", label: "Most used" },
  { value: "name", label: "Name (A→Z)" },
];

export default function SettingsPage() {
  const [blob, setBlob] = useState<ConnectionsBlob>({ connections: [], activeId: null });
  const [prefs, setPrefs] = useState<AppPrefs>(DEFAULT_PREFS);
  // Bumping this triggers a brief "Saved" flash in the header. Tied to a
  // counter rather than a boolean so back-to-back saves still re-show it.
  const [savedTick, setSavedTick] = useState(0);
  // Connections currently in edit mode (URL + key inputs visible). A
  // connection auto-locks into read-only display as soon as both fields
  // are committed with non-empty values. To change a locked credential
  // pair the user must delete and re-add — this prevents accidental
  // edits to credentials that are working.
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const initial = readConnections();
    setBlob(initial);
    setPrefs(readPrefs());
    // Any pre-existing connection missing creds starts in edit mode so the
    // user can finish setting it up.
    setEditingIds(
      new Set(
        initial.connections
          .filter((c) => !c.n8nUrl || !c.apiKey)
          .map((c) => c.id),
      ),
    );
  }, []);

  useEffect(() => {
    if (savedTick === 0) return;
    const t = setTimeout(() => setSavedTick(0), 1800);
    return () => clearTimeout(t);
  }, [savedTick]);

  const flashSaved = () => setSavedTick((n) => n + 1);

  // Persist immediately for structural changes (add/delete/set-default).
  // Text edits stay local until blur — see commitField — to avoid writing
  // a half-typed URL on every keystroke (which would refetch workflows).
  const commitBlob = (next: ConnectionsBlob) => {
    setBlob(next);
    writeConnections(next);
    flashSaved();
  };

  const updateConn = (id: string, patch: Partial<Connection>) => {
    setBlob((b) => ({
      ...b,
      connections: b.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  const commitField = (id: string, patch: Partial<Connection>) => {
    const cleaned: Partial<Connection> = { ...patch };
    if (cleaned.name !== undefined) cleaned.name = cleaned.name.trim() || "Untitled";
    if (cleaned.n8nUrl !== undefined) cleaned.n8nUrl = cleaned.n8nUrl.trim();
    if (cleaned.apiKey !== undefined) cleaned.apiKey = cleaned.apiKey.trim();
    const nextConnections = blob.connections.map((c) =>
      c.id === id ? { ...c, ...cleaned } : c,
    );
    commitBlob({ ...blob, connections: nextConnections });
    // Auto-lock once both credentials are filled in.
    const updated = nextConnections.find((c) => c.id === id);
    if (updated && updated.n8nUrl && updated.apiKey) {
      setEditingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const addConn = () => {
    const conn: Connection = {
      id: newConnectionId(),
      name: `Connection ${blob.connections.length + 1}`,
      n8nUrl: "",
      apiKey: "",
    };
    commitBlob({
      connections: [...blob.connections, conn],
      activeId: blob.activeId ?? conn.id,
    });
    setEditingIds((prev) => new Set([...prev, conn.id]));
  };

  const deleteConn = (id: string) => {
    const next = blob.connections.filter((c) => c.id !== id);
    const activeId = blob.activeId === id ? (next[0]?.id ?? null) : blob.activeId;
    commitBlob({ connections: next, activeId });
  };

  const setActive = (id: string) => {
    commitBlob({ ...blob, activeId: id });
  };

  const updatePref = <K extends keyof AppPrefs>(k: K, v: AppPrefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    writePrefs(next);
    flashSaved();
  };

  return (
    <main className="min-h-screen bg-[var(--panel)]">
      <header className="pl-10 pr-6 py-3 border-b border-[var(--border)] flex items-center gap-4 sticky top-0 bg-[var(--panel)] z-10">
        <Link
          href="/"
          className="text-[12px] text-[var(--muted)] hover:text-[var(--text)] no-underline"
        >
          ← Back
        </Link>
        <div className="flex-1" />
        <span
          aria-live="polite"
          className={`text-[12px] font-medium text-[#059669] transition-opacity duration-200 ${
            savedTick > 0 ? "opacity-100" : "opacity-0"
          }`}
        >
          ✓ Saved
        </span>
        <Link
          href="/"
          title="Close settings"
          aria-label="Close settings"
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--muted)] hover:bg-[var(--bg)] hover:text-[var(--text)] no-underline text-[16px] leading-none"
        >
          ✕
        </Link>
      </header>

      <div className="max-w-[820px] mx-auto px-6 pt-10 pb-[40vh]">
        <h1 className="m-0 mb-8 text-[28px] font-semibold tracking-[-0.02em] text-[var(--text)]">
          Settings
        </h1>
        <SectionLabel>Connections</SectionLabel>
        <div className="text-[12px] text-[var(--muted)] mb-3 leading-relaxed">
          Add one or more n8n instances. The default one loads when the app
          opens. Switch between connections from the sidebar.
        </div>

        {blob.connections.length === 0 && (
          <div className="text-[12px] text-[var(--muted-2)] border border-dashed border-[var(--border-strong)] rounded px-3 py-4 text-center mb-3">
            No connections yet. Add one to get started.
          </div>
        )}

        {blob.connections.map((conn) => {
          const isActive = conn.id === blob.activeId;
          return (
            <div
              key={conn.id}
              className={`border rounded-md p-3 mb-3 ${
                isActive
                  ? "border-[var(--n8n)] bg-[color-mix(in_srgb,var(--n8n)_6%,transparent)]"
                  : "border-[var(--border-strong)] bg-[var(--panel)]"
              }`}
            >
              <div className="grid grid-cols-2 gap-3 mb-3 items-center">
                <InlineField label="Label">
                  <input
                    type="text"
                    value={conn.name}
                    onChange={(e) => updateConn(conn.id, { name: e.target.value })}
                    onBlur={(e) => commitField(conn.id, { name: e.target.value })}
                    placeholder="Name"
                    className="form-input"
                  />
                </InlineField>
                <div className="flex items-center justify-end gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0">
                    <input
                      type="radio"
                      name="default-connection"
                      checked={isActive}
                      onChange={() => setActive(conn.id)}
                      className="accent-[var(--n8n)] cursor-pointer"
                    />
                    <span className="text-[11px] uppercase tracking-[0.5px] font-semibold text-[var(--muted)]">
                      {isActive ? "Default" : "Set default"}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete connection "${conn.name || "Untitled"}"? This only removes it from this browser.`,
                        )
                      ) {
                        deleteConn(conn.id);
                      }
                    }}
                    title="Delete this connection"
                    aria-label="Delete this connection"
                    className="w-7 h-7 rounded text-[var(--muted)] hover:text-[var(--red)] hover:bg-[var(--bg)] cursor-pointer bg-transparent border-0 flex items-center justify-center"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <InlineField label="n8n URL">
                  {editingIds.has(conn.id) ? (
                    <input
                      type="text"
                      className="form-input"
                      value={conn.n8nUrl}
                      onChange={(e) => updateConn(conn.id, { n8nUrl: e.target.value })}
                      onBlur={(e) => commitField(conn.id, { n8nUrl: e.target.value })}
                      placeholder="https://your-n8n-host"
                    />
                  ) : (
                    <UrlDisplay url={conn.n8nUrl} />
                  )}
                </InlineField>
                <InlineField label="API key">
                  {editingIds.has(conn.id) ? (
                    <input
                      type="password"
                      className="form-input"
                      value={conn.apiKey}
                      onChange={(e) => updateConn(conn.id, { apiKey: e.target.value })}
                      onBlur={(e) => commitField(conn.id, { apiKey: e.target.value })}
                      placeholder="n8n_api_…"
                    />
                  ) : (
                    <ApiKeyDisplay value={conn.apiKey} />
                  )}
                </InlineField>
              </div>
            </div>
          );
        })}

        <div className="mb-6">
          <button
            type="button"
            onClick={addConn}
            className="text-[12px] font-medium px-3 py-1.5 rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--text)] hover:border-[var(--n8n)] hover:text-[var(--n8n)] cursor-pointer"
          >
            + Add connection
          </button>
        </div>

        <SectionLabel className="mt-6">Display preferences</SectionLabel>
        <Toggle
          label="Show node parameters expanded by default"
          checked={prefs.paramsDefaultOpen}
          onChange={(v) => updatePref("paramsDefaultOpen", v)}
        />
        <Field label="Default data view">
          <Segmented
            value={prefs.dataViewDefault}
            onChange={(v) => updatePref("dataViewDefault", v as "table" | "json")}
            options={[
              { value: "table", label: "Table" },
              { value: "json", label: "JSON" },
            ]}
          />
        </Field>
        <Toggle
          label="Show single-item results as a vertical key/value list"
          help="When off, single-item results render as a one-row horizontal table."
          checked={prefs.singleItemAsList}
          onChange={(v) => updatePref("singleItemAsList", v)}
        />
        <Toggle
          label="Show failed-execution alerts"
          help="A red badge appears top-right when executions fail in the last 24h. Click it for a list, X to dismiss until the next failure."
          checked={prefs.failureNotifications}
          onChange={(v) => updatePref("failureNotifications", v)}
        />
        <Field
          label="Default workflow sort"
          help="Used when you load the app fresh. You can still change the sort from the sidebar at any time."
        >
          <select
            value={prefs.sidebarSortDefault}
            onChange={(e) => updatePref("sidebarSortDefault", e.target.value as SidebarSort)}
            className="form-input max-w-[260px]"
          >
            {SORT_LABELS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </Field>

        <hr className="mt-16 border-0 border-t border-[var(--border-strong)]" />
        <div className="pt-5 text-[11px] text-[var(--muted-2)] flex items-center gap-2 flex-wrap">
          <span>Built by</span>
          <a
            href="https://serdarsalim.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--muted)] hover:text-[var(--n8n)] no-underline"
          >
            serdarsalim.com
          </a>
          <span aria-hidden>·</span>
          <a
            href="https://github.com/serdarsalim/n8n-studio"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--muted)] hover:text-[var(--n8n)] no-underline"
          >
            GitHub
          </a>
          <span aria-hidden>·</span>
          <span>Feature requests:</span>
          <a
            href="mailto:serdarsalim@gmail.com"
            className="text-[var(--muted)] hover:text-[var(--n8n)] no-underline"
          >
            serdarsalim@gmail.com
          </a>
        </div>

      </div>

      <style>{formInputCss}</style>
    </main>
  );
}

function TrashIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function InlineField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[11px] uppercase tracking-[0.5px] font-semibold text-[var(--muted)] flex-shrink-0 w-[64px]">
        {label}
      </span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function UrlDisplay({ url }: { url: string }) {
  let href = url;
  try {
    href = new URL(url).origin;
  } catch {
    href = url.replace(/\/+$/, "");
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="form-input flex items-center gap-2 text-[var(--n8n)] hover:underline no-underline truncate"
      title={href}
    >
      <span className="truncate">{href}</span>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3 h-3 flex-shrink-0 text-[var(--muted)]"
        aria-hidden
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  );
}

function ApiKeyDisplay({ value }: { value: string }) {
  // Show first 4 + last 4 chars with the middle masked. Identifies the key
  // without exposing it — the same shape Stripe/AWS use when they reveal a
  // credential. Keys shorter than 8 chars are fully masked.
  const masked =
    value.length >= 8
      ? `${value.slice(0, 4)}${"•".repeat(8)}${value.slice(-4)}`
      : "•".repeat(Math.max(8, value.length));
  return (
    <div
      className="form-input text-[var(--muted)] font-mono tracking-[0.05em] select-all"
      title="API key (masked). Delete and re-add the connection to change it."
    >
      {masked}
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--muted)] mb-2 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-[14px] last:mb-0">
      <label className="block text-[12px] text-[var(--muted)] mb-[6px] font-medium">{label}</label>
      {children}
      {help && <div className="text-[11px] text-[var(--muted-2)] mt-[4px]">{help}</div>}
    </div>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 mb-[14px] last:mb-0 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] accent-[var(--n8n)] cursor-pointer"
      />
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {help && <div className="text-[11px] text-[var(--muted-2)] mt-[2px]">{help}</div>}
      </div>
    </label>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-[5px] border border-[var(--border-strong)] overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-[12px] py-[6px] text-[12px] font-medium cursor-pointer border-0 ${
            value === opt.value
              ? "bg-[var(--panel-soft-2)] text-[var(--text)]"
              : "bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const formInputCss = `
.form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
}
.form-input:focus { border-color: var(--n8n); }
`;
