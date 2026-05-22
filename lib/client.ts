"use client";

import type {
  AppSettings,
  Connection,
  ConnectionsBlob,
  N8nExecution,
  N8nWorkflow,
  N8nWorkflowSummary,
} from "./types";

// Mirror of N8nExecutionSummary in lib/n8n.ts — kept here so the client
// bundle never pulls in the server-only n8n module.
export interface ExecutionSummary {
  id: string;
  workflowId?: string;
  startedAt?: string;
  stoppedAt?: string;
  status?: string;
  finished?: boolean;
  mode?: string;
}

const SETTINGS_KEY = "n8n-flow-tester:settings";
const CONNECTIONS_KEY = "n8n-flow-tester:connections";
const THEME_KEY = "theme";
const TEST_COUNTS_KEY = "n8n-flow-tester:testCounts";
const SESSION_KEY = "n8n-flow-tester:session";
const PREFS_KEY = "n8n-flow-tester:prefs";
const TEST_PAYLOADS_KEY = "n8n-flow-tester:testPayloads";
// Legacy storage key used before test payloads replaced fixtures. Read once
// on first access to migrate the user's saved payloads, then dropped.
const LEGACY_FIXTURES_KEY = "n8n-flow-tester:fixtures";
const EXEC_ACCESS_KEY = "n8n-flow-tester:execAccess";

export function readSettings(): AppSettings {
  if (typeof window === "undefined") return { n8nUrl: "", apiKey: "" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { n8nUrl: "", apiKey: "" };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { n8nUrl: parsed.n8nUrl ?? "", apiKey: parsed.apiKey ?? "" };
  } catch {
    return { n8nUrl: "", apiKey: "" };
  }
}

export function writeSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function newConnectionId(): string {
  return `cn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const EMPTY_CONNECTIONS: ConnectionsBlob = { connections: [], activeId: null };

export function readConnections(): ConnectionsBlob {
  if (typeof window === "undefined") return EMPTY_CONNECTIONS;
  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ConnectionsBlob>;
      const connections = Array.isArray(parsed.connections) ? parsed.connections : [];
      const activeId =
        parsed.activeId && connections.some((c) => c.id === parsed.activeId)
          ? parsed.activeId
          : (connections[0]?.id ?? null);
      return { connections, activeId };
    }
    // Migrate legacy single-connection settings on first read.
    const legacy = localStorage.getItem(SETTINGS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Partial<AppSettings>;
      if (parsed.n8nUrl || parsed.apiKey) {
        const conn: Connection = {
          id: newConnectionId(),
          name: "Default",
          n8nUrl: parsed.n8nUrl ?? "",
          apiKey: parsed.apiKey ?? "",
        };
        const blob: ConnectionsBlob = { connections: [conn], activeId: conn.id };
        localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(blob));
        return blob;
      }
    }
  } catch {}
  return EMPTY_CONNECTIONS;
}

export function writeConnections(blob: ConnectionsBlob) {
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(blob));
  // Keep legacy single-settings key in sync with the active connection,
  // so anything still reading readSettings() gets the right creds.
  const active = activeConnection(blob);
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ n8nUrl: active?.n8nUrl ?? "", apiKey: active?.apiKey ?? "" }),
  );
}

export function activeConnection(blob: ConnectionsBlob): Connection | null {
  return blob.connections.find((c) => c.id === blob.activeId) ?? null;
}

export function activeSettings(blob: ConnectionsBlob): AppSettings {
  const active = activeConnection(blob);
  return { n8nUrl: active?.n8nUrl ?? "", apiKey: active?.apiKey ?? "" };
}

export function readTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function setTheme(t: "light" | "dark") {
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.classList.toggle("dark", t === "dark");
}

// Per-workflow test counter, used to surface "most tested" in the picker.
export function readTestCounts(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TEST_COUNTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function bumpTestCount(workflowId: string) {
  const counts = readTestCounts();
  counts[workflowId] = (counts[workflowId] ?? 0) + 1;
  localStorage.setItem(TEST_COUNTS_KEY, JSON.stringify(counts));
}

// Working state persistence: workflow, execution, and input the user
// currently has loaded. Survives refresh so you don't lose context.
// Stored as a single blob — easy to clear, easy to migrate later.
export interface SessionBlob {
  workflow: N8nWorkflow | null;
  execution: N8nExecution | null;
  inputText: string;
  inputJson: unknown;
  selectedPayloadId: string | null;
}

const EMPTY_SESSION: SessionBlob = {
  workflow: null,
  execution: null,
  inputText: "",
  inputJson: {},
  selectedPayloadId: null,
};

export function readSession(): SessionBlob {
  if (typeof window === "undefined") return EMPTY_SESSION;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return EMPTY_SESSION;
    const parsed = JSON.parse(raw) as Partial<SessionBlob> & {
      selectedFixtureId?: string | null;
    };
    return {
      workflow: parsed.workflow ?? null,
      execution: parsed.execution ?? null,
      inputText: parsed.inputText ?? "",
      inputJson: parsed.inputJson ?? {},
      // Accept the legacy field name so a user who upgrades mid-session
      // doesn't lose their loaded payload selection on first reload.
      selectedPayloadId: parsed.selectedPayloadId ?? parsed.selectedFixtureId ?? null,
    };
  } catch {
    return EMPTY_SESSION;
  }
}

// UI preferences — defaults the user can override and have stick.
export type SidebarSort = "usage" | "name" | "updated" | "created" | "run";

export interface AppPrefs {
  paramsDefaultOpen: boolean;
  dataViewDefault: "table" | "json";
  singleItemAsList: boolean;
  sidebarSortDefault: SidebarSort;
  failureNotifications: boolean;
}

export const DEFAULT_PREFS: AppPrefs = {
  paramsDefaultOpen: true,
  dataViewDefault: "table",
  singleItemAsList: true,
  sidebarSortDefault: "updated",
  failureNotifications: true,
};

const VALID_SORTS: SidebarSort[] = ["usage", "name", "updated", "created", "run"];

export function readPrefs(): AppPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    const sort = parsed.sidebarSortDefault;
    return {
      paramsDefaultOpen: parsed.paramsDefaultOpen ?? DEFAULT_PREFS.paramsDefaultOpen,
      dataViewDefault: parsed.dataViewDefault ?? DEFAULT_PREFS.dataViewDefault,
      singleItemAsList: parsed.singleItemAsList ?? DEFAULT_PREFS.singleItemAsList,
      sidebarSortDefault:
        sort && VALID_SORTS.includes(sort) ? sort : DEFAULT_PREFS.sidebarSortDefault,
      failureNotifications:
        parsed.failureNotifications ?? DEFAULT_PREFS.failureNotifications,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(p: AppPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  // Broadcast so any open components can refresh their defaults.
  window.dispatchEvent(new CustomEvent("prefs:changed"));
}

export function writeSession(s: SessionBlob) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded (executions can be large). Drop the execution data
    // and try again — workflow + input is the most useful slice to keep.
    try {
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ ...s, execution: null }),
      );
    } catch {
      // Give up silently — next change will retry.
    }
  }
}

function authHeaders(s: AppSettings): HeadersInit {
  return { "x-n8n-url": s.n8nUrl, "x-n8n-api-key": s.apiKey };
}

// Tolerant JSON parser. If the response body isn't JSON (e.g. the dev server
// returned an HTML error page because a route handler crashed or doesn't
// exist), surface a useful error instead of a raw SyntaxError.
async function parseJsonOrThrow(res: Response, label: string): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (!ct.includes("application/json")) {
    const snippet = text.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `${label}: server returned ${res.status} ${ct || "no content-type"} — ${snippet || "(empty body)"}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label}: invalid JSON (status ${res.status})`);
  }
}

export async function apiListWorkflows(s: AppSettings): Promise<N8nWorkflowSummary[]> {
  const res = await fetch("/api/workflows", { headers: authHeaders(s) });
  const data = (await parseJsonOrThrow(res, "GET /api/workflows")) as {
    workflows?: N8nWorkflowSummary[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Failed to list workflows");
  return data.workflows ?? [];
}

export async function apiGetWorkflow(s: AppSettings, id: string): Promise<N8nWorkflow> {
  const res = await fetch(`/api/workflows/${id}`, { headers: authHeaders(s) });
  const data = (await parseJsonOrThrow(res, `GET /api/workflows/${id}`)) as {
    workflow?: N8nWorkflow;
    error?: string;
  };
  if (!res.ok || !data.workflow) throw new Error(data.error || "Failed to load workflow");
  return data.workflow;
}

export async function apiListExecutions(
  s: AppSettings,
  workflowId: string,
  limit = 25,
): Promise<ExecutionSummary[]> {
  const res = await fetch(`/api/executions?workflowId=${encodeURIComponent(workflowId)}&limit=${limit}`, {
    headers: authHeaders(s),
  });
  const data = (await parseJsonOrThrow(res, "GET /api/executions")) as {
    executions?: ExecutionSummary[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Failed to list executions");
  return data.executions ?? [];
}

// Globally-scoped execution list — returns the most recent executions across
// every workflow on the instance. Used by the sidebar to color workflow rows
// by last-run status without making one request per workflow.
export async function apiListRecentExecutions(
  s: AppSettings,
  limit = 250,
): Promise<ExecutionSummary[]> {
  const res = await fetch(`/api/executions?limit=${limit}`, {
    headers: authHeaders(s),
  });
  const data = (await parseJsonOrThrow(res, "GET /api/executions")) as {
    executions?: ExecutionSummary[];
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Failed to list executions");
  return data.executions ?? [];
}

export async function apiGetExecution(s: AppSettings, id: string): Promise<N8nExecution> {
  const res = await fetch(`/api/executions/${id}`, { headers: authHeaders(s) });
  const data = (await parseJsonOrThrow(res, `GET /api/executions/${id}`)) as {
    execution?: N8nExecution;
    error?: string;
  };
  if (!res.ok || !data.execution) throw new Error(data.error || "Failed to load execution");
  return data.execution;
}

export async function apiRun(
  s: AppSettings,
  args: { webhookUrl: string; payload: unknown; workflowId: string },
): Promise<{ executionId: string | null; webhookResponse: unknown; note?: string }> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { ...authHeaders(s), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await parseJsonOrThrow(res, "POST /api/run")) as {
    executionId?: string | null;
    webhookResponse?: unknown;
    note?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Run failed");
  return {
    executionId: data.executionId ?? null,
    webhookResponse: data.webhookResponse,
    note: data.note,
  };
}

// ─── Test payloads ─────────────────────────────────────────────────────
// Named, reusable JSON inputs the user crafts to test scenarios against a
// workflow. Scoped per-workflow and stored as one blob keyed by workflow id.
// Created only via explicit user action (no auto-creation from executions).
export interface TestPayload {
  id: string;
  name: string;
  text: string;
  json: unknown;
  createdAt: number;
}

function readAllTestPayloads(): Record<string, TestPayload[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TEST_PAYLOADS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, TestPayload[]>;
    // One-time migration from the old fixtures key. We drop entries that
    // were auto-created from past executions — those polluted the list and
    // were the main reason for the rename. Manual entries are preserved.
    const legacy = localStorage.getItem(LEGACY_FIXTURES_KEY);
    if (!legacy) return {};
    const parsed = JSON.parse(legacy) as Record<
      string,
      Array<{
        id: string;
        name: string;
        text: string;
        json: unknown;
        source?: string;
        createdAt: number;
      }>
    >;
    const migrated: Record<string, TestPayload[]> = {};
    for (const [wfId, list] of Object.entries(parsed)) {
      const cleaned = list
        .filter((p) => p.source !== "execution")
        .map<TestPayload>((p) => ({
          id: p.id,
          name: p.name,
          text: p.text,
          json: p.json,
          createdAt: p.createdAt,
        }));
      if (cleaned.length > 0) migrated[wfId] = cleaned;
    }
    localStorage.setItem(TEST_PAYLOADS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

function writeAllTestPayloads(all: Record<string, TestPayload[]>) {
  try {
    localStorage.setItem(TEST_PAYLOADS_KEY, JSON.stringify(all));
  } catch {
    // quota — drop silently; user can clear via DevTools if needed.
  }
}

export function readTestPayloads(workflowId: string): TestPayload[] {
  return readAllTestPayloads()[workflowId] ?? [];
}

export function writeTestPayloads(workflowId: string, payloads: TestPayload[]) {
  const all = readAllTestPayloads();
  all[workflowId] = payloads;
  writeAllTestPayloads(all);
}

function newTestPayloadId(): string {
  return `tp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createTestPayload(
  workflowId: string,
  name: string,
  text: string,
  json: unknown,
): TestPayload {
  const payload: TestPayload = {
    id: newTestPayloadId(),
    name,
    text,
    json,
    createdAt: Date.now(),
  };
  writeTestPayloads(workflowId, [...readTestPayloads(workflowId), payload]);
  return payload;
}

export function updateTestPayload(
  workflowId: string,
  payloadId: string,
  patch: Partial<Pick<TestPayload, "name" | "text" | "json">>,
): TestPayload | null {
  const payloads = readTestPayloads(workflowId);
  const idx = payloads.findIndex((p) => p.id === payloadId);
  if (idx === -1) return null;
  const updated = { ...payloads[idx], ...patch };
  payloads[idx] = updated;
  writeTestPayloads(workflowId, payloads);
  return updated;
}

export function deleteTestPayload(workflowId: string, payloadId: string) {
  writeTestPayloads(
    workflowId,
    readTestPayloads(workflowId).filter((p) => p.id !== payloadId),
  );
}

// ─── Past execution access tracking ───────────────────────────────────
// "How often did I open this past execution, and when last?" — scoped per
// (workflow, execution). Stored as a nested map.
export interface ExecAccess {
  count: number;
  lastOpenedAt: number;
}

type ExecAccessMap = Record<string, Record<string, ExecAccess>>;

function readAllExecAccess(): ExecAccessMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(EXEC_ACCESS_KEY);
    return raw ? (JSON.parse(raw) as ExecAccessMap) : {};
  } catch {
    return {};
  }
}

function writeAllExecAccess(all: ExecAccessMap) {
  try {
    localStorage.setItem(EXEC_ACCESS_KEY, JSON.stringify(all));
  } catch {
    // ignore quota
  }
}

export function readExecAccess(workflowId: string): Record<string, ExecAccess> {
  return readAllExecAccess()[workflowId] ?? {};
}

export function bumpExecAccess(workflowId: string, executionId: string) {
  const all = readAllExecAccess();
  const forWf = all[workflowId] ?? {};
  const prev = forWf[executionId];
  forWf[executionId] = {
    count: (prev?.count ?? 0) + 1,
    lastOpenedAt: Date.now(),
  };
  all[workflowId] = forWf;
  writeAllExecAccess(all);
}
