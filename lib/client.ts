"use client";

import type { AppSettings, N8nExecution, N8nWorkflow, N8nWorkflowSummary } from "./types";

// Mirror of N8nExecutionSummary in lib/n8n.ts — kept here so the client
// bundle never pulls in the server-only n8n module.
export interface ExecutionSummary {
  id: string;
  startedAt?: string;
  stoppedAt?: string;
  status?: string;
  finished?: boolean;
  mode?: string;
}

const SETTINGS_KEY = "n8n-flow-tester:settings";
const THEME_KEY = "theme";
const TEST_COUNTS_KEY = "n8n-flow-tester:testCounts";
const SESSION_KEY = "n8n-flow-tester:session";
const PREFS_KEY = "n8n-flow-tester:prefs";
const FIXTURES_KEY = "n8n-flow-tester:fixtures";
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
  selectedFixtureId: string | null;
}

const EMPTY_SESSION: SessionBlob = {
  workflow: null,
  execution: null,
  inputText: "",
  inputJson: {},
  selectedFixtureId: null,
};

export function readSession(): SessionBlob {
  if (typeof window === "undefined") return EMPTY_SESSION;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return EMPTY_SESSION;
    const parsed = JSON.parse(raw) as Partial<SessionBlob>;
    return {
      workflow: parsed.workflow ?? null,
      execution: parsed.execution ?? null,
      inputText: parsed.inputText ?? "",
      inputJson: parsed.inputJson ?? {},
      selectedFixtureId: parsed.selectedFixtureId ?? null,
    };
  } catch {
    return EMPTY_SESSION;
  }
}

// UI preferences — defaults the user can override and have stick.
export interface AppPrefs {
  paramsDefaultOpen: boolean;
  dataViewDefault: "table" | "json";
  singleItemAsList: boolean;
  testMode: boolean;
}

export const DEFAULT_PREFS: AppPrefs = {
  paramsDefaultOpen: true,
  dataViewDefault: "table",
  singleItemAsList: true,
  testMode: false,
};

export function readPrefs(): AppPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    return {
      paramsDefaultOpen: parsed.paramsDefaultOpen ?? DEFAULT_PREFS.paramsDefaultOpen,
      dataViewDefault: parsed.dataViewDefault ?? DEFAULT_PREFS.dataViewDefault,
      singleItemAsList: parsed.singleItemAsList ?? DEFAULT_PREFS.singleItemAsList,
      testMode: parsed.testMode ?? DEFAULT_PREFS.testMode,
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

export interface TestRunResult {
  executionId: string | null;
  testWorkflowId: string;
  testWorkflowCreated: boolean;
  testWebhookPath: string;
  stubbedCount: number;
  stubbedNodes: string[];
  subWorkflowMirrorCount: number;
  subWorkflowMirrors: Record<string, string>;
  webhookResponse: unknown;
  note?: string;
}

export async function apiTestRun(
  s: AppSettings,
  args: { workflowId: string; payload: unknown },
): Promise<TestRunResult> {
  const res = await fetch("/api/test-run", {
    method: "POST",
    headers: { ...authHeaders(s), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const data = (await parseJsonOrThrow(res, "POST /api/test-run")) as Partial<TestRunResult> & {
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Test run failed");
  return {
    executionId: data.executionId ?? null,
    testWorkflowId: data.testWorkflowId ?? "",
    testWorkflowCreated: data.testWorkflowCreated ?? false,
    testWebhookPath: data.testWebhookPath ?? "",
    stubbedCount: data.stubbedCount ?? 0,
    stubbedNodes: data.stubbedNodes ?? [],
    subWorkflowMirrorCount: data.subWorkflowMirrorCount ?? 0,
    subWorkflowMirrors: data.subWorkflowMirrors ?? {},
    webhookResponse: data.webhookResponse,
    note: data.note,
  };
}

export async function apiDeleteTestMirror(
  s: AppSettings,
  workflowId: string,
): Promise<{ deleted: boolean }> {
  const res = await fetch(`/api/test-mirror?workflowId=${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
    headers: authHeaders(s),
  });
  const data = (await parseJsonOrThrow(res, "DELETE /api/test-mirror")) as {
    deleted?: boolean;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || "Failed to delete test mirror");
  return { deleted: data.deleted ?? false };
}

// ─── Fixtures ──────────────────────────────────────────────────────────
// Named, reusable JSON inputs, scoped per workflow. Stored as one blob
// keyed by workflow id so loading one workflow shows only its fixtures.
// Fixtures sourced from past executions carry executionId for lineage.
export interface Fixture {
  id: string;
  name: string;
  text: string;
  json: unknown;
  source: "manual" | "execution";
  executionId?: string;
  createdAt: number;
}

function readAllFixtures(): Record<string, Fixture[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(FIXTURES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Fixture[]>) : {};
  } catch {
    return {};
  }
}

function writeAllFixtures(all: Record<string, Fixture[]>) {
  try {
    localStorage.setItem(FIXTURES_KEY, JSON.stringify(all));
  } catch {
    // quota — drop silently; user can clear via DevTools if needed.
  }
}

export function readFixtures(workflowId: string): Fixture[] {
  return readAllFixtures()[workflowId] ?? [];
}

export function writeFixtures(workflowId: string, fixtures: Fixture[]) {
  const all = readAllFixtures();
  all[workflowId] = fixtures;
  writeAllFixtures(all);
}

function newFixtureId(): string {
  return `fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createFixture(
  workflowId: string,
  name: string,
  text: string,
  json: unknown,
): Fixture {
  const fixture: Fixture = {
    id: newFixtureId(),
    name,
    text,
    json,
    source: "manual",
    createdAt: Date.now(),
  };
  writeFixtures(workflowId, [...readFixtures(workflowId), fixture]);
  return fixture;
}

// Idempotent: returns the existing fixture for this execution if we
// already have one. Otherwise creates one with the given name.
export function upsertFixtureFromExecution(
  workflowId: string,
  executionId: string,
  name: string,
  text: string,
  json: unknown,
): Fixture {
  const fixtures = readFixtures(workflowId);
  const existing = fixtures.find((f) => f.executionId === executionId);
  if (existing) return existing;
  const fixture: Fixture = {
    id: newFixtureId(),
    name,
    text,
    json,
    source: "execution",
    executionId,
    createdAt: Date.now(),
  };
  writeFixtures(workflowId, [...fixtures, fixture]);
  return fixture;
}

export function updateFixture(
  workflowId: string,
  fixtureId: string,
  patch: Partial<Pick<Fixture, "name" | "text" | "json">>,
): Fixture | null {
  const fixtures = readFixtures(workflowId);
  const idx = fixtures.findIndex((f) => f.id === fixtureId);
  if (idx === -1) return null;
  const updated = { ...fixtures[idx], ...patch };
  fixtures[idx] = updated;
  writeFixtures(workflowId, fixtures);
  return updated;
}

export function deleteFixture(workflowId: string, fixtureId: string) {
  writeFixtures(
    workflowId,
    readFixtures(workflowId).filter((f) => f.id !== fixtureId),
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
