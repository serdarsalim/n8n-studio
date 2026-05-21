"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  apiListExecutions,
  createTestPayload,
  deleteTestPayload,
  type ExecutionSummary,
  type TestPayload,
  readTestPayloads,
  updateTestPayload,
} from "@/lib/client";
import type { AppSettings } from "@/lib/types";
import { Btn, Modal } from "./modal";

type Tab = "runs" | "payloads";
const TAB_KEY = "n8n-ft.inputModal.tab";

export function InputModal({
  open,
  onClose,
  workflowId,
  settings,
  initialText,
  selectedPayloadId,
  running,
  onChange,
  onSelectPayload,
  onLoadFromExecution,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string | null;
  settings: AppSettings;
  initialText: string;
  selectedPayloadId: string | null;
  running: boolean;
  onChange: (text: string, parsed: unknown) => void;
  onSelectPayload: (id: string | null) => void;
  onLoadFromExecution: (executionId: string) => Promise<void>;
  onRun: () => void;
}) {
  const [payloads, setPayloads] = useState<TestPayload[]>([]);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("runs");

  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setError(null);
    if (workflowId) setPayloads(readTestPayloads(workflowId));
    else setPayloads([]);
    try {
      const saved = localStorage.getItem(TAB_KEY) as Tab | null;
      if (saved === "runs" || saved === "payloads") setTab(saved);
    } catch {}
  }, [open, initialText, workflowId]);

  const selectedPayload = useMemo(
    () => payloads.find((p) => p.id === selectedPayloadId) ?? null,
    [payloads, selectedPayloadId],
  );
  const isDirty = selectedPayload ? selectedPayload.text !== text : false;

  function refreshPayloads() {
    if (!workflowId) return;
    setPayloads(readTestPayloads(workflowId));
  }

  function changeTab(next: Tab) {
    setTab(next);
    try { localStorage.setItem(TAB_KEY, next); } catch {}
  }

  function handleTextChange(next: string) {
    setText(next);
    try {
      const parsed = next.trim() ? JSON.parse(next) : {};
      setError(null);
      onChange(next, parsed);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
    }
  }

  function handleSelectPayload(id: string) {
    const p = payloads.find((x) => x.id === id);
    if (!p) return;
    setText(p.text);
    setError(null);
    onSelectPayload(id);
    onChange(p.text, p.json);
  }

  function handleNewPayload() {
    if (!workflowId) return;
    const name = uniqueName("New payload", payloads);
    let parsed: unknown = {};
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    const payload = createTestPayload(workflowId, name, text, parsed);
    setPayloads([...payloads, payload]);
    onSelectPayload(payload.id);
    changeTab("payloads");
  }

  function handleUpdatePayload() {
    if (!workflowId || !selectedPayload || error) return;
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
      return;
    }
    updateTestPayload(workflowId, selectedPayload.id, { text, json: parsed });
    refreshPayloads();
  }

  function handleRenamePayload(id: string, name: string) {
    if (!workflowId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    updateTestPayload(workflowId, id, { name: trimmed });
    refreshPayloads();
  }

  function handleDeletePayload(id: string) {
    if (!workflowId) return;
    deleteTestPayload(workflowId, id);
    if (selectedPayloadId === id) onSelectPayload(null);
    refreshPayloads();
  }

  return (
    <Modal open={open} onClose={onClose} title="Input" wide>
      <div className="flex gap-3 h-full min-h-0">
        <aside className="w-[300px] flex-shrink-0 flex flex-col border border-[var(--border)] rounded-md bg-[var(--panel-soft)] overflow-hidden">
          <div className="flex border-b border-[var(--border)]">
            <TabButton active={tab === "runs"} onClick={() => changeTab("runs")}>
              Recent runs
            </TabButton>
            <TabButton active={tab === "payloads"} onClick={() => changeTab("payloads")}>
              Test payloads
            </TabButton>
          </div>

          {tab === "runs" && (
            <RecentRunsList
              workflowId={workflowId}
              settings={settings}
              onPick={onLoadFromExecution}
            />
          )}

          {tab === "payloads" && (
            <>
              <button
                type="button"
                onClick={handleNewPayload}
                disabled={!workflowId}
                className="text-left text-[12px] text-[var(--blue)] hover:text-[var(--text)] px-3 py-2 border-b border-[var(--border)] bg-transparent border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + New payload (from current editor)
              </button>
              <div className="overflow-y-auto flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border-strong)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--border-strong)] [&::-webkit-scrollbar-thumb]:rounded-full">
                {payloads.length === 0 && (
                  <div className="text-[11px] text-[var(--muted-2)] px-3 py-3 italic leading-relaxed">
                    No test payloads yet. Paste JSON on the right and hit
                    + New payload to save scenarios you want to test.
                  </div>
                )}
                {payloads.map((p) => (
                  <PayloadRow
                    key={p.id}
                    payload={p}
                    selected={p.id === selectedPayloadId}
                    dirty={p.id === selectedPayloadId && isDirty}
                    onSelect={() => handleSelectPayload(p.id)}
                    onRename={(name) => handleRenamePayload(p.id, name)}
                    onDelete={() => handleDeletePayload(p.id)}
                  />
                ))}
              </div>
              {selectedPayload && isDirty && !error && (
                <button
                  type="button"
                  onClick={handleUpdatePayload}
                  className="text-left text-[12px] text-[var(--blue)] hover:text-[var(--text)] px-3 py-2 border-t border-[var(--border)] bg-transparent border-0 cursor-pointer"
                >
                  ↑ Update “{selectedPayload.name}”
                </button>
              )}
            </>
          )}
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder='{ "contactId": "abc", "qualified": true }'
            className="w-full flex-1 min-h-[200px] px-3 py-2 text-[12px] font-mono rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel-soft)] text-[var(--text)] outline-none focus:border-[var(--n8n)] resize-none"
          />
          {error ? (
            <div className="text-[12px] text-[var(--red-text)] mt-2 font-mono">
              {error} · last valid version still applied
            </div>
          ) : selectedPayload && isDirty ? (
            <div className="text-[11px] text-[var(--muted-2)] mt-2">
              Editing “{selectedPayload.name}” (unsaved — applied live)
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            {(() => {
              const disabled = !workflowId || !text.trim() || running || !!error;
              const tooltip = !workflowId
                ? "Load a workflow first"
                : !text.trim()
                  ? "Paste a payload first"
                  : error
                    ? "Fix the JSON error first"
                    : undefined;
              return (
                <Btn
                  primary
                  onClick={() => {
                    onClose();
                    onRun();
                  }}
                  disabled={disabled}
                  tooltip={tooltip}
                >
                  {running ? "Running…" : "▶ Run this payload"}
                </Btn>
              );
            })()}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-[12px] font-medium cursor-pointer bg-transparent border-0 border-b-2 ${
        active
          ? "text-[var(--text)] border-[var(--n8n)]"
          : "text-[var(--muted)] border-transparent hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function PayloadRow({
  payload,
  selected,
  dirty,
  onSelect,
  onRename,
  onDelete,
}: {
  payload: TestPayload;
  selected: boolean;
  dirty: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(payload.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(payload.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, payload.name]);

  function commit() {
    setEditing(false);
    if (draft.trim() && draft.trim() !== payload.name) onRename(draft.trim());
  }

  return (
    <div
      className={`group flex items-center gap-[6px] px-2 py-[6px] text-[12px] cursor-pointer ${
        selected
          ? "bg-[var(--selected-bg)] border-l-2 border-[var(--selected-border)]"
          : "hover:bg-[var(--panel-soft-2)] border-l-2 border-transparent"
      }`}
      onClick={() => {
        if (!editing) onSelect();
      }}
    >
      <span
        className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${
          selected ? "bg-[var(--selected-border)]" : "bg-transparent border border-[var(--muted-2)]"
        }`}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(payload.name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-[var(--panel)] border border-[var(--border-strong)] rounded px-[4px] py-0 text-[12px] font-medium outline-none focus:border-[var(--n8n)]"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            if (selected) {
              e.stopPropagation();
              setEditing(true);
            }
          }}
          className="flex-1 min-w-0 text-left truncate bg-transparent border-0 p-0 cursor-pointer font-medium text-[var(--text)]"
          title={payload.name}
        >
          {payload.name}
          {dirty && <span className="ml-1 text-[var(--muted)] italic">(dirty)</span>}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete payload “${payload.name}”?`)) onDelete();
        }}
        title="Delete payload"
        aria-label="Delete payload"
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--red)] bg-transparent border-0 p-0 cursor-pointer text-[14px] leading-none w-[14px] h-[14px] flex items-center justify-center"
      >
        ×
      </button>
    </div>
  );
}

function uniqueName(base: string, payloads: TestPayload[]): string {
  const names = new Set(payloads.map((p) => p.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function RecentRunsList({
  workflowId,
  settings,
  onPick,
}: {
  workflowId: string | null;
  settings: AppSettings;
  onPick: (executionId: string) => Promise<void>;
}) {
  const [items, setItems] = useState<ExecutionSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [lastLoadedId, setLastLoadedId] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId || !settings.n8nUrl || !settings.apiKey) {
      setItems(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiListExecutions(settings, workflowId, 25)
      .then((list) => { if (!cancelled) setItems(list); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workflowId, settings.n8nUrl, settings.apiKey]);

  if (!workflowId) {
    return (
      <div className="text-[11px] text-[var(--muted-2)] px-3 py-3 italic">
        Load a workflow first.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="text-[11px] text-[var(--muted-2)] px-3 py-3 italic">Loading…</div>
    );
  }
  if (error) {
    return <div className="text-[11px] text-[var(--red-text)] px-3 py-3">{error}</div>;
  }
  if (items && items.length === 0) {
    return (
      <div className="text-[11px] text-[var(--muted-2)] px-3 py-3 italic">
        No executions yet.
      </div>
    );
  }
  return (
    <div className="overflow-y-auto flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border-strong)_transparent] [&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--border-strong)] [&::-webkit-scrollbar-thumb]:rounded-full py-1">
      {items?.map((e) => (
        <button
          key={e.id}
          type="button"
          disabled={picking !== null}
          onClick={async () => {
            setError(null);
            setPicking(e.id);
            try {
              await onPick(e.id);
              setLastLoadedId(e.id);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setPicking(null);
            }
          }}
          className={`group w-full flex items-center gap-2 px-3 py-[5px] text-[11px] text-left border-0 cursor-pointer disabled:opacity-50 disabled:cursor-default border-l-2 ${
            lastLoadedId === e.id
              ? "bg-[var(--selected-bg)] border-[var(--selected-border)]"
              : "bg-transparent border-transparent hover:bg-[var(--panel-soft-2)]"
          }`}
          title={`Load input from #${e.id}`}
        >
          <StatusDot status={e.status} />
          <span className="font-mono text-[var(--text)]">#{e.id}</span>
          <span className="text-[var(--muted-2)] truncate flex-1">
            {fmtExecRow(e)}
          </span>
          {picking === e.id ? (
            <span className="text-[var(--muted)] italic">loading…</span>
          ) : lastLoadedId === e.id ? (
            <span className="text-[var(--selected-border)] text-[10px] font-semibold uppercase tracking-[0.3px]">
              loaded
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}


function StatusDot({ status }: { status?: string }) {
  const color =
    status === "success"
      ? "bg-[var(--green)]"
      : status === "error" || status === "canceled"
        ? "bg-[var(--red)]"
        : status === "running" || status === "waiting" || status === "new"
          ? "bg-[var(--blue)]"
          : "bg-[var(--muted-2)]";
  return <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${color}`} />;
}

function fmtExecRow(e: ExecutionSummary): string {
  const when = e.startedAt
    ? relativeTime(Date.parse(e.startedAt))
    : "—";
  const status = e.status ? ` · ${e.status}` : "";
  return `${when}${status}`;
}

function relativeTime(t: number): string {
  if (!t) return "—";
  const delta = Math.max(0, Date.now() - t) / 1000;
  if (delta < 60) return `${Math.floor(delta)}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
