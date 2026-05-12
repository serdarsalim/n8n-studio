"use client";
import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/types";
import {
  apiGetExecution,
  apiListExecutions,
  type ExecAccess,
  type ExecutionSummary,
  readExecAccess,
} from "@/lib/client";
import { Modal } from "./modal";

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtStarted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[14px] h-[14px]">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-[14px] h-[14px]">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[14px] h-[14px] animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  );
}

export function ExecutionsModal({
  open,
  onClose,
  settings,
  workflowId,
  workflowName,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  workflowId: string | null;
  workflowName: string;
  onPick: (executionId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ExecutionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [accessMap, setAccessMap] = useState<Record<string, ExecAccess>>({});

  async function copyExecution(id: string) {
    if (copyingId) return;
    setCopyingId(id);
    setError(null);
    try {
      const exec = await apiGetExecution(settings, id);
      await navigator.clipboard.writeText(JSON.stringify(exec, null, 2));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      setError(`Could not copy execution: ${(e as Error).message}`);
    } finally {
      setCopyingId(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (!workflowId) {
      setError("Load a workflow first.");
      return;
    }
    if (!settings.n8nUrl || !settings.apiKey) {
      setError("Set your n8n URL and API key in Settings first.");
      return;
    }
    setLoading(true);
    setError(null);
    setAccessMap(readExecAccess(workflowId));
    apiListExecutions(settings, workflowId, 25)
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, settings, workflowId]);

  return (
    <Modal open={open} onClose={onClose} title={`Past executions · ${workflowName || "—"}`} wide>
      {error && (
        <div className="text-[13px] text-[var(--red-text)] bg-[var(--red-bg)] px-3 py-2 rounded mb-3">
          {error}
        </div>
      )}
      {loading && <div className="text-[13px] text-[var(--muted)] px-2 py-4">Loading…</div>}
      <div className="h-[420px] min-h-[200px] overflow-y-auto">
        {(items ?? []).map((ex) => {
          const ok = ex.status === "success" || (ex.finished && ex.status !== "error");
          const dur =
            ex.startedAt && ex.stoppedAt
              ? Math.max(0, Date.parse(ex.stoppedAt) - Date.parse(ex.startedAt))
              : null;
          const copying = copyingId === ex.id;
          const copied = copiedId === ex.id;
          return (
            <div
              key={ex.id}
              role="button"
              tabIndex={0}
              onClick={() => onPick(ex.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onPick(ex.id);
              }}
              className="group w-full grid grid-cols-[auto_auto_1fr_auto_auto_auto] gap-[10px] items-center px-3 py-[10px] border border-[var(--border)] rounded-md mb-[6px] text-[13px] cursor-pointer bg-transparent hover:border-[var(--n8n)] hover:bg-[color-mix(in_srgb,var(--n8n)_8%,transparent)] last:mb-0"
            >
              <span
                className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[12px] font-bold text-white ${
                  ok ? "bg-[var(--green)]" : "bg-[var(--red)]"
                }`}
              >
                {ok ? "✓" : "✕"}
              </span>
              <span className="font-medium whitespace-nowrap flex flex-col items-start gap-[2px]">
                <span>{ex.startedAt ? fmtStarted(ex.startedAt) : "—"}</span>
                {accessMap[ex.id] && (
                  <span className="text-[10px] text-[var(--muted)] font-mono font-normal">
                    opened {accessMap[ex.id].count}× · last {fmtRelative(accessMap[ex.id].lastOpenedAt)}
                  </span>
                )}
              </span>
              <span className="text-[12px] text-[var(--muted)] font-mono text-right">
                {dur != null ? `${(dur / 1000).toFixed(2)}s` : ""}
              </span>
              <span className="text-[11px] text-[var(--muted-2)] font-mono">#{ex.id}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyExecution(ex.id);
                }}
                disabled={copying}
                title="Copy full execution JSON"
                aria-label="Copy execution JSON"
                className={`w-[24px] h-[24px] flex items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-soft-2)] cursor-pointer bg-transparent border-0 transition-opacity ${
                  copied ? "opacity-100 text-[var(--green)]" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                }`}
              >
                {copying ? <Spinner /> : copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          );
        })}
        {!loading && !error && items && items.length === 0 && (
          <div className="text-[13px] text-[var(--muted)] px-2 py-4 text-center">
            No executions yet for this workflow.
          </div>
        )}
      </div>
    </Modal>
  );
}
