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
  return res.json();
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
  startedAt?: string;
  stoppedAt?: string;
  status?: string;
  finished?: boolean;
  mode?: string;
}

export async function listExecutions(
  creds: N8nCreds,
  workflowId: string,
  limit = 25,
): Promise<N8nExecutionSummary[]> {
  const data = await n8nFetch(creds, `/executions?workflowId=${workflowId}&limit=${limit}`);
  const list = (data?.data ?? data) as N8nExecutionSummary[];
  return list;
}
