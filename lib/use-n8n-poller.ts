"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiListRecentExecutions, apiListWorkflows, type ExecutionSummary } from "./client";
import type { Connection, N8nWorkflowSummary } from "./types";

export interface TaggedWorkflow extends N8nWorkflowSummary {
  connectionId: string;
  connectionName: string;
}

export interface TaggedExecution extends ExecutionSummary {
  connectionId: string;
  connectionName: string;
  n8nUrl: string;
}

export interface RefreshResult {
  ok: boolean;
  changed: boolean;
  workflowsCount: number;
}

export interface PollerData {
  workflows: TaggedWorkflow[] | null;
  executions: TaggedExecution[];
  // Latest execution status / startedAt per workflow, keyed by
  // `${connectionId}:${workflowId}`. Newest-first dedup means the first
  // execution we see for a workflow wins.
  lastStatus: Record<string, string>;
  lastRunAt: Record<string, string>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<RefreshResult>;
}

const POLL_INTERVAL_MS = 60_000;
const EXEC_LIMIT = 250;

// Single source of truth for workflow + execution data across every
// connection. The sidebar renders from these; the failure-alerts badge
// derives its list from them too. One poll every 60s instead of two
// duplicate timers.
export function useN8nPoller(connections: Connection[]): PollerData {
  const sources = connections.filter((c) => c.n8nUrl && c.apiKey);
  const sourcesKey = sources.map((c) => `${c.id}|${c.n8nUrl}`).join(",");

  const [workflows, setWorkflows] = useState<TaggedWorkflow[] | null>(null);
  const [executions, setExecutions] = useState<TaggedExecution[]>([]);
  const [lastStatus, setLastStatus] = useState<Record<string, string>>({});
  const [lastRunAt, setLastRunAt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumping this kicks the polling effect to re-run on demand.
  const [tick, setTick] = useState(0);
  // Tracks the most recent fetch generation so a late response from a
  // superseded run can't overwrite fresher data.
  const genRef = useRef(0);
  // Hand the manual-refresh promise back to the caller — sidebar needs it
  // to fire a toast with the actual outcome.
  const pendingResolveRef = useRef<((r: RefreshResult) => void) | null>(null);

  useEffect(() => {
    if (sources.length === 0) {
      setWorkflows(null);
      setExecutions([]);
      setLastStatus({});
      setLastRunAt({});
      setError("No connections configured.");
      return;
    }

    let cancelled = false;
    const gen = ++genRef.current;
    if (workflows === null) setLoading(true);
    setError(null);

    let workflowsFailed = false;
    let workflowsChanged = false;
    let workflowsCount = 0;

    // Per-connection results. On failure we keep the previous data for that
    // connection so a single flaky API call doesn't nuke its sidebar group.
    const wfPromise = Promise.all(
      sources.map((c) =>
        apiListWorkflows({ n8nUrl: c.n8nUrl, apiKey: c.apiKey })
          .then((wfs) => ({
            ok: true as const,
            id: c.id,
            wfs: wfs.map<TaggedWorkflow>((w) => ({
              ...w,
              connectionId: c.id,
              connectionName: c.name,
            })),
          }))
          .catch(() => {
            workflowsFailed = true;
            return { ok: false as const, id: c.id };
          }),
      ),
    ).then((results) => {
      if (cancelled || gen !== genRef.current) return;
      setWorkflows((prev) => {
        const next: TaggedWorkflow[] = [];
        for (const r of results) {
          if (r.ok) {
            next.push(...r.wfs);
          } else if (prev) {
            // Reuse previous workflows for the connection that just failed.
            next.push(...prev.filter((w) => w.connectionId === r.id));
          }
        }
        workflowsCount = next.length;
        if (prev && jsonEqual(prev, next)) return prev;
        workflowsChanged = true;
        return next;
      });
    }).finally(() => {
      if (!cancelled && gen === genRef.current) setLoading(false);
    });

    const execPromise = Promise.all(
      sources.map((c) =>
        apiListRecentExecutions({ n8nUrl: c.n8nUrl, apiKey: c.apiKey }, EXEC_LIMIT)
          .then((execs) => ({
            ok: true as const,
            id: c.id,
            execs: execs.map<TaggedExecution>((e) => ({
              ...e,
              connectionId: c.id,
              connectionName: c.name,
              n8nUrl: c.n8nUrl,
            })),
          }))
          .catch(() => ({ ok: false as const, id: c.id })),
      ),
    ).then((results) => {
      if (cancelled || gen !== genRef.current) return;
      setExecutions((prev) => {
        const next: TaggedExecution[] = [];
        for (const r of results) {
          if (r.ok) {
            next.push(...r.execs);
          } else {
            // Keep prior executions for the failed connection so the
            // failure-alerts badge doesn't blink and the sidebar's
            // last-status colors stay stable.
            next.push(...prev.filter((e) => e.connectionId === r.id));
          }
        }
        const statusMap: Record<string, string> = {};
        const runAtMap: Record<string, string> = {};
        for (const e of next) {
          if (!e.workflowId) continue;
          const key = `${e.connectionId}:${e.workflowId}`;
          if (statusMap[key]) continue;
          if (e.status) statusMap[key] = e.status;
          if (e.startedAt) runAtMap[key] = e.startedAt;
        }
        setLastStatus((p) => (jsonEqual(p, statusMap) ? p : statusMap));
        setLastRunAt((p) => (jsonEqual(p, runAtMap) ? p : runAtMap));
        return jsonEqual(prev, next) ? prev : next;
      });
    });

    Promise.all([wfPromise, execPromise]).then(() => {
      // Always clear the refreshing flag — even if cancelled by a newer
      // tick. Otherwise the manual-refresh button stays disabled.
      setRefreshing(false);
      const resolve = pendingResolveRef.current;
      pendingResolveRef.current = null;
      if (resolve) {
        resolve({
          ok: !workflowsFailed,
          changed: workflowsChanged,
          workflowsCount,
        });
      }
      if (workflowsFailed && !cancelled && gen === genRef.current) {
        setError("Couldn't reach n8n.");
      }
    });

    return () => {
      cancelled = true;
    };
    // sourcesKey captures connection identity/url changes; raw connections
    // ref changes too often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesKey, tick]);

  // Auto-refresh every 60s, visibility-aware. Pauses on backgrounded tabs
  // and fires an immediate catch-up tick on return.
  useEffect(() => {
    let intervalId: number | null = null;
    const bump = () => setTick((n) => n + 1);
    const start = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") bump();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        bump();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const refresh = useCallback((): Promise<RefreshResult> => {
    setRefreshing(true);
    return new Promise<RefreshResult>((resolve) => {
      pendingResolveRef.current = resolve;
      setTick((n) => n + 1);
    });
  }, []);

  return {
    workflows,
    executions,
    lastStatus,
    lastRunAt,
    loading,
    refreshing,
    error,
    refresh,
  };
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
