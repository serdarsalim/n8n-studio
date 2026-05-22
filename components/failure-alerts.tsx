"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modals/modal";

export interface FailedExecution {
  executionId: string;
  workflowId: string;
  workflowName: string;
  connectionId: string;
  connectionName: string;
  n8nUrl: string;
  startedAt: string;
  status: string;
}

interface FailureGroup {
  key: string;
  workflowId: string;
  workflowName: string;
  connectionId: string;
  connectionName: string;
  n8nUrl: string;
  count: number;
  // The execution we link to from the modal row — newest failure for this
  // workflow today, since that's almost always the one worth investigating.
  latest: FailedExecution;
}

function groupByWorkflow(failures: FailedExecution[]): FailureGroup[] {
  const map = new Map<string, FailureGroup>();
  for (const f of failures) {
    const key = `${f.connectionId}:${f.workflowId}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        key,
        workflowId: f.workflowId,
        workflowName: f.workflowName,
        connectionId: f.connectionId,
        connectionName: f.connectionName,
        n8nUrl: f.n8nUrl,
        count: 1,
        latest: f,
      });
    } else {
      existing.count++;
      if (Date.parse(f.startedAt) > Date.parse(existing.latest.startedAt)) {
        existing.latest = f;
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => Date.parse(b.latest.startedAt) - Date.parse(a.latest.startedAt),
  );
}

export function FailureAlerts({
  failures,
  showAllConnections,
}: {
  failures: FailedExecution[];
  // When true, the modal labels each row with its connection (multi-account
  // setups). Single-connection users don't need the noise.
  showAllConnections: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  // Group keys (connection:workflow) the user has acknowledged via the badge
  // X. Lives in component memory only — a refresh re-surfaces everything,
  // matching the "today's failures" framing.
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupByWorkflow(failures), [failures]);
  const undismissed = useMemo(
    () => groups.filter((g) => !dismissedKeys.has(g.key)),
    [groups, dismissedKeys],
  );

  if (undismissed.length === 0 && !modalOpen) {
    return null;
  }

  const dismissBadge = () => {
    setDismissedKeys(new Set(groups.map((g) => g.key)));
  };

  return (
    <>
      {undismissed.length > 0 && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          title={`${undismissed.length} workflow${undismissed.length === 1 ? "" : "s"} failed today — click to view`}
          aria-label="View failed executions"
          className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-[var(--red-bg)] text-[var(--red-text)] border border-[var(--red-text)]/40 hover:border-[var(--red-text)] cursor-pointer text-[12px] font-medium"
        >
          <WarningIcon />
          <span>
            {undismissed.length} failed
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissBadge();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                dismissBadge();
              }
            }}
            className="ml-0.5 w-5 h-5 rounded flex items-center justify-center text-[var(--red-text)] hover:bg-[var(--red-text)]/15 cursor-pointer"
          >
            <CloseIcon />
          </span>
        </button>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Failed workflows · last 24h (${groups.length})`}
      >
        {groups.length === 0 ? (
          <p className="text-[13px] text-[var(--muted)]">
            Nothing failed in the last 24 hours.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {groups.map((g) => (
              <FailureRow key={g.key} group={g} showConnection={showAllConnections} />
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}

function FailureRow({
  group,
  showConnection,
}: {
  group: FailureGroup;
  showConnection: boolean;
}) {
  let origin = group.n8nUrl;
  try {
    origin = new URL(group.n8nUrl).origin;
  } catch {
    origin = group.n8nUrl.replace(/\/+$/, "");
  }
  const href = `${origin}/workflow/${group.workflowId}/executions/${group.latest.executionId}`;
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 px-3 py-2 rounded border border-[var(--border)] hover:border-[var(--n8n)] no-underline text-[var(--text)]"
      >
        <span className="w-2 h-2 rounded-full bg-[var(--red-text)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate">{group.workflowName}</div>
          <div className="text-[11px] text-[var(--muted)] truncate">
            {showConnection && <>{group.connectionName} · </>}
            failed {group.count}× in 24h
            {" · "}last <RelativeTime iso={group.latest.startedAt} />
          </div>
        </div>
        <ExternalIcon />
      </a>
    </li>
  );
}

function RelativeTime({ iso }: { iso: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return <>{fmtRelative(iso)}</>;
}

function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleString();
}

function WarningIcon() {
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
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3 h-3"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 text-[var(--muted)] flex-shrink-0"
      aria-hidden
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
