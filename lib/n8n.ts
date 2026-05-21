// Server-side n8n REST client. Used only inside app/api/* route handlers.
// Credentials flow in per-request via headers from the browser (the browser
// holds them in localStorage and forwards on each call), so nothing is
// persisted on the server.

import type { N8nExecution, N8nWorkflow, N8nWorkflowSummary } from "./types";

export interface N8nCreds {
  url: string;
  apiKey: string;
}

export function readCredsFromHeaders(h: Headers): N8nCreds | null {
  const url = h.get("x-n8n-url");
  const apiKey = h.get("x-n8n-api-key");
  if (!url || !apiKey) return null;
  return { url: normalizeN8nUrl(url), apiKey };
}

// Accept anything the user might paste — base URL, workflows page URL,
// execution URL — and reduce it to the origin n8n's API lives under.
function normalizeN8nUrl(input: string): string {
  const trimmed = input.trim();
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

async function n8nFetch(creds: N8nCreds, path: string, init?: RequestInit) {
  const res = await fetch(`${creds.url}/api/v1${path}`, {
    ...init,
    headers: {
      "X-N8N-API-KEY": creds.apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`n8n ${res.status} ${path}: ${text.slice(0, 200)}`);
  }
  // Some endpoints (activate/deactivate, occasionally delete) reply with an
  // empty body. Don't blow up on those.
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function listWorkflows(creds: N8nCreds): Promise<N8nWorkflowSummary[]> {
  const data = await n8nFetch(creds, "/workflows?limit=250");
  const list = (data?.data ?? data) as N8nWorkflowSummary[];
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    active: w.active,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
}

export async function getWorkflow(creds: N8nCreds, id: string): Promise<N8nWorkflow> {
  const data = await n8nFetch(creds, `/workflows/${id}`);
  return data as N8nWorkflow;
}

export async function getExecution(creds: N8nCreds, id: string): Promise<N8nExecution> {
  const data = await n8nFetch(creds, `/executions/${id}?includeData=true`);
  return data as N8nExecution;
}

export interface N8nExecutionSummary {
  id: string;
  workflowId?: string;
  startedAt?: string;
  stoppedAt?: string;
  status?: string;
  finished?: boolean;
  mode?: string;
}

export async function listExecutions(
  creds: N8nCreds,
  workflowId: string | null,
  limit = 25,
): Promise<N8nExecutionSummary[]> {
  const wf = workflowId ? `workflowId=${encodeURIComponent(workflowId)}&` : "";
  const data = await n8nFetch(creds, `/executions?${wf}limit=${limit}`);
  const list = (data?.data ?? data) as N8nExecutionSummary[];
  return list;
}

// ─── Workflow write operations (test mode) ─────────────────────────────
// n8n's public API treats `active` as read-only on POST/PUT — you activate
// via the dedicated endpoint after the workflow exists. The body must be
// pruned of read-only fields (id, active, createdAt, updatedAt, tags,
// versionId, …) or n8n will reject the request.

const WRITE_ALLOWED_FIELDS = ["name", "nodes", "connections", "settings", "staticData"] as const;

// n8n's POST/PUT /workflows strictly rejects unknown keys inside `settings`
// (e.g. internal-only fields like `callerPolicy` that GET returns but the
// write endpoint refuses). Keep only what the public schema documents.
const SETTINGS_ALLOWED_FIELDS = [
  "executionOrder",
  "timezone",
  "saveDataErrorExecution",
  "saveDataSuccessExecution",
  "saveExecutionProgress",
  "saveManualExecutions",
  "executionTimeout",
  "errorWorkflow",
] as const;

function pruneSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== "object") return {};
  const src = settings as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_ALLOWED_FIELDS) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return out;
}

function pruneForWrite(workflow: N8nWorkflow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of WRITE_ALLOWED_FIELDS) {
    const v = (workflow as unknown as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  // settings must be present (empty is fine) and free of unknown keys.
  out.settings = pruneSettings(out.settings);
  return out;
}

export async function createWorkflow(
  creds: N8nCreds,
  workflow: N8nWorkflow,
): Promise<{ id: string }> {
  const data = await n8nFetch(creds, "/workflows", {
    method: "POST",
    body: JSON.stringify(pruneForWrite(workflow)),
  });
  const id = (data?.id ?? data?.data?.id) as string | undefined;
  if (!id) throw new Error("n8n POST /workflows: response missing id");
  return { id };
}

export async function updateWorkflow(
  creds: N8nCreds,
  id: string,
  workflow: N8nWorkflow,
): Promise<void> {
  await n8nFetch(creds, `/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify(pruneForWrite(workflow)),
  });
}

export async function activateWorkflow(creds: N8nCreds, id: string): Promise<void> {
  // Prefer the dedicated endpoint; fall back to PATCH for older n8n versions.
  try {
    await n8nFetch(creds, `/workflows/${id}/activate`, { method: "POST" });
  } catch {
    await n8nFetch(creds, `/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  }
}

export async function deactivateWorkflow(creds: N8nCreds, id: string): Promise<void> {
  try {
    await n8nFetch(creds, `/workflows/${id}/deactivate`, { method: "POST" });
  } catch {
    await n8nFetch(creds, `/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
  }
}

