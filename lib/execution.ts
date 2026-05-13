// Parse an n8n execution into the flat NodeCheck list the UI renders.
// The goal is graceful degradation: when a node shape is unknown, still
// show "fired ✓ / skipped ✗" with no detail rows — never crash.

import type { ConditionCheck, N8nExecution, N8nNode, N8nWorkflow, NodeCheck } from "./types";

export function parseExecution(
  workflow: N8nWorkflow,
  execution: N8nExecution | null,
): NodeCheck[] {
  const runData = execution?.data?.resultData?.runData ?? {};
  const visible = workflow.nodes.filter((n) => !n.disabled && !isCosmetic(n.type));
  const ordered = topoOrder(visible, workflow);
  const predecessors = buildPredecessorMap(workflow);
  return ordered.map((node) => buildNodeCheck(node, runData[node.name], runData, predecessors));
}

// Depth-first topological order, following the workflow's connection
// graph. Each node is emitted before its successors; deepest descent of
// the first branch comes first. Sibling branches are tie-broken by output
// index, then by workflow.y. Cycles or disconnected nodes get appended at
// the end in workflow.x order so nothing is lost.
export function topoOrder(nodes: N8nNode[], workflow: N8nWorkflow): N8nNode[] {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const successors = new Map<string, Array<{ name: string; outIdx: number }>>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    successors.set(n.name, []);
    inDegree.set(n.name, 0);
  }
  const conns = workflow.connections as Record<
    string,
    { main?: Array<Array<{ node: string; type: string; index: number }>> } | undefined
  >;
  for (const [fromName, entry] of Object.entries(conns ?? {})) {
    if (!byName.has(fromName)) continue;
    const branches = entry?.main ?? [];
    branches.forEach((targets, outIdx) => {
      for (const t of targets ?? []) {
        if (!byName.has(t.node)) continue;
        successors.get(fromName)!.push({ name: t.node, outIdx });
        inDegree.set(t.node, (inDegree.get(t.node) ?? 0) + 1);
      }
    });
  }

  const result: N8nNode[] = [];
  const visited = new Set<string>();
  const visit = (name: string) => {
    if (visited.has(name)) return;
    visited.add(name);
    const node = byName.get(name);
    if (node) result.push(node);
    const children = (successors.get(name) ?? []).slice().sort((a, b) => {
      if (a.outIdx !== b.outIdx) return a.outIdx - b.outIdx;
      const ay = byName.get(a.name)?.position?.[1] ?? 0;
      const by = byName.get(b.name)?.position?.[1] ?? 0;
      return ay - by;
    });
    for (const c of children) visit(c.name);
  };

  // Roots = in-degree zero. Sort by x then y so the trigger comes first.
  const roots = nodes
    .filter((n) => (inDegree.get(n.name) ?? 0) === 0)
    .sort((a, b) => {
      const ax = a.position?.[0] ?? 0;
      const bx = b.position?.[0] ?? 0;
      if (ax !== bx) return ax - bx;
      return (a.position?.[1] ?? 0) - (b.position?.[1] ?? 0);
    });
  for (const r of roots) visit(r.name);

  // Anything left (cycle, isolated node): append in flow-position order.
  const remaining = nodes
    .filter((n) => !visited.has(n.name))
    .sort((a, b) => (a.position?.[0] ?? 0) - (b.position?.[0] ?? 0));
  result.push(...remaining);

  return result;
}

// Map of "node name -> list of {predecessorName, outputIndex}" so we can
// trace what flowed into each node. Derived from workflow.connections.
type PredecessorMap = Map<string, Array<{ from: string; outputIndex: number }>>;

function buildPredecessorMap(workflow: N8nWorkflow): PredecessorMap {
  const map: PredecessorMap = new Map();
  const conns = workflow.connections as Record<
    string,
    { main?: Array<Array<{ node: string; type: string; index: number }>> }
  >;
  for (const [fromName, entry] of Object.entries(conns ?? {})) {
    const branches = entry?.main ?? [];
    branches.forEach((targets, outputIndex) => {
      for (const t of targets ?? []) {
        const existing = map.get(t.node) ?? [];
        existing.push({ from: fromName, outputIndex });
        map.set(t.node, existing);
      }
    });
  }
  return map;
}

// Nodes that don't execute and shouldn't show up in a test result list.
function isCosmetic(type: string): boolean {
  return type.endsWith(".stickyNote") || type.endsWith(".StickyNote");
}

function buildNodeCheck(
  node: N8nNode,
  runs: import("./types").N8nNodeRun[] | undefined,
  allRunData: Record<string, import("./types").N8nNodeRun[]>,
  predecessors: PredecessorMap,
): NodeCheck {
  const fired = !!runs && runs.length > 0;
  const firstRun = runs?.[0];
  const conditions = fired && firstRun ? extractConditions(node, firstRun) : [];
  const meta = fired && firstRun ? extractMeta(node, firstRun) : undefined;
  const error = firstRun?.error?.message;

  const outputItems = fired ? extractItems(firstRun?.data?.main) : [];
  const inputItems = fired ? extractInputItems(node, allRunData, predecessors) : [];

  // Decide status: fired / skipped (branch not taken) / error.
  let status: NodeCheck["status"];
  if (error) {
    status = "error";
  } else if (fired) {
    status = "fired";
  } else {
    status = classifyMissingNode(node, allRunData, predecessors);
  }

  // For IF/Switch nodes, surface which output index carried items.
  const branchTaken = fired && firstRun ? extractBranchTaken(node, firstRun) : undefined;
  const outputBranches = fired && firstRun ? extractOutputBranches(node, firstRun) : undefined;
  const conditionCombinator = conditions.length > 0
    ? readCombinator((node.parameters ?? {}) as Record<string, unknown>)
    : undefined;

  return {
    nodeName: node.name,
    nodeType: node.type,
    status,
    fired: status === "fired",
    conditions,
    branchTaken,
    conditionCombinator,
    meta,
    error,
    parameters: (node.parameters ?? {}) as Record<string, unknown>,
    inputItems,
    outputItems,
    outputBranches,
  };
}

// A node didn't appear in runData. Determine whether it was a legitimate
// branch-skip (predecessor took the other path) or an error (predecessor
// directed items here but execution didn't happen).
function classifyMissingNode(
  node: N8nNode,
  allRunData: Record<string, import("./types").N8nNodeRun[]>,
  predecessors: PredecessorMap,
): "skipped" | "error" {
  const preds = predecessors.get(node.name);
  if (!preds || preds.length === 0) return "skipped"; // trigger that didn't fire
  // If ANY predecessor sent items down the edge to this node, it should
  // have run. Otherwise it was a clean branch-skip.
  for (const p of preds) {
    const predRun = allRunData[p.from]?.[0];
    if (!predRun) continue; // predecessor itself didn't fire — chain skip
    const branch = predRun.data?.main?.[p.outputIndex];
    if (Array.isArray(branch) && branch.length > 0) {
      return "error";
    }
  }
  return "skipped";
}

function extractBranchTaken(
  node: N8nNode,
  run: import("./types").N8nNodeRun,
): "true" | "false" | number | undefined {
  const t = node.type;
  const isIf = t.endsWith(".if") || t.endsWith(".If");
  const isSwitch = t.endsWith(".switch") || t.endsWith(".Switch");
  if (!isIf && !isSwitch) return undefined;
  const main = run.data?.main;
  if (!main) return undefined;
  // Only return a single "took X" when exactly ONE branch received items.
  // Multi-branch routing (per-item split) returns undefined; the caller
  // will render per-branch sections instead of a single label.
  let firstIdx = -1;
  let count = 0;
  for (let i = 0; i < main.length; i++) {
    if (Array.isArray(main[i]) && main[i].length > 0) {
      if (firstIdx < 0) firstIdx = i;
      count++;
    }
  }
  if (count !== 1) return undefined;
  if (isIf) return firstIdx === 0 ? "true" : "false";
  return firstIdx;
}

function extractOutputBranches(
  node: N8nNode,
  run: import("./types").N8nNodeRun,
): NodeCheck["outputBranches"] {
  const t = node.type;
  const isIf = t.endsWith(".if") || t.endsWith(".If");
  const isSwitch = t.endsWith(".switch") || t.endsWith(".Switch");
  const isFilter = t.endsWith(".filter") || t.endsWith(".Filter");
  if (!isIf && !isSwitch && !isFilter) return undefined;
  const main = run.data?.main;
  if (!main) return undefined;
  const out: NonNullable<NodeCheck["outputBranches"]> = [];
  for (let i = 0; i < main.length; i++) {
    const branch = main[i];
    if (!Array.isArray(branch) || branch.length === 0) continue;
    const items = branch.map((it) => (it as { json?: unknown }).json ?? it);
    const label = isIf ? (i === 0 ? "TRUE" : "FALSE") : `branch ${i}`;
    out.push({ index: i, label, items });
  }
  return out;
}

function extractItems(
  main: Array<Array<{ json: unknown; [k: string]: unknown }>> | undefined,
): unknown[] {
  if (!main) return [];
  // main is an array of branches; for a simple node, items live at main[0].
  // For an IF/Switch, the items live in whichever branch was taken — we
  // concatenate non-empty branches for display.
  const flat: unknown[] = [];
  for (const branch of main) {
    if (Array.isArray(branch)) {
      for (const item of branch) flat.push((item as { json?: unknown }).json ?? item);
    }
  }
  return flat;
}

function extractInputItems(
  node: N8nNode,
  allRunData: Record<string, import("./types").N8nNodeRun[]>,
  predecessors: PredecessorMap,
): unknown[] {
  const preds = predecessors.get(node.name);
  if (!preds || preds.length === 0) {
    // Trigger / orphan node — its "input" is its own output (e.g. webhook
    // payload as received). Trace into runData directly.
    const own = allRunData[node.name]?.[0]?.data?.main;
    return extractItems(own);
  }
  const flat: unknown[] = [];
  for (const p of preds) {
    const predOutput = allRunData[p.from]?.[0]?.data?.main?.[p.outputIndex];
    if (Array.isArray(predOutput)) {
      for (const item of predOutput) flat.push((item as { json?: unknown }).json ?? item);
    }
  }
  return flat;
}

function extractConditions(node: N8nNode, run: import("./types").N8nNodeRun): ConditionCheck[] {
  const t = node.type;
  const isIf = t.endsWith(".if") || t.endsWith(".If");
  const isFilter = t.endsWith(".filter") || t.endsWith(".Filter");
  const isSwitch = t.endsWith(".switch") || t.endsWith(".Switch");
  if (!isIf && !isFilter && !isSwitch) return [];

  // n8n stores IF/Filter v2 conditions in parameters.conditions.conditions[].
  // We need the *resolved* left/right values; execution data doesn't always
  // expose them directly, so we fall back to the parameter expression text
  // and let the user see what was being compared.
  const params = (node.parameters ?? {}) as Record<string, unknown>;
  const conds = readConditionList(params);
  if (!conds.length) return [];

  // Without per-condition resolved values we can only report the overall
  // branch result. For IF: the first output is "true" branch — if main[0]
  // has items, condition passed overall.
  const output = run.data?.main;
  const tookTrueBranch = !!(output && output[0] && output[0].length > 0);

  return conds.map((c) => ({
    leftLabel: c.left,
    rightLabel: c.right,
    passed: tookTrueBranch,
    operator: c.operator,
  }));
}

interface RawCondition {
  left: string;
  right: string;
  operator?: { type: string; operation: string; singleValue?: boolean };
}

function readConditionList(params: Record<string, unknown>): RawCondition[] {
  const out: RawCondition[] = [];
  // IF v2 / Filter v2: { conditions: { conditions: [{leftValue, rightValue, operator}] } }
  const cv2 = (params.conditions as Record<string, unknown> | undefined)?.conditions;
  if (Array.isArray(cv2)) {
    for (const c of cv2) {
      const r = c as Record<string, unknown>;
      const op = r.operator as { type?: string; operation?: string; singleValue?: boolean } | undefined;
      out.push({
        left: stringify(r.leftValue),
        right: stringify(r.rightValue),
        operator: op?.operation
          ? { type: op.type ?? "string", operation: op.operation, singleValue: op.singleValue }
          : undefined,
      });
    }
    return out;
  }
  // IF v1: { conditions: { string: [...], number: [...], boolean: [...] } }
  const cv1 = params.conditions as Record<string, unknown> | undefined;
  if (cv1) {
    for (const key of ["string", "number", "boolean"] as const) {
      const arr = cv1[key];
      if (Array.isArray(arr)) {
        for (const c of arr) {
          const r = c as Record<string, unknown>;
          out.push({
            left: stringify(r.value1),
            right: stringify(r.value2),
            operator: typeof r.operation === "string"
              ? { type: key, operation: r.operation }
              : undefined,
          });
        }
      }
    }
  }
  return out;
}

function readCombinator(params: Record<string, unknown>): "and" | "or" {
  const c = (params.conditions as Record<string, unknown> | undefined)?.combinator;
  return c === "or" ? "or" : "and";
}

function extractMeta(node: N8nNode, run: import("./types").N8nNodeRun): NodeCheck["meta"] {
  const t = node.type;
  const isHttp = t.includes("httpRequest") || t.includes("HttpRequest");
  if (!isHttp) return undefined;
  const params = (node.parameters ?? {}) as Record<string, unknown>;
  const method = stringify(params.method ?? params.requestMethod ?? "GET");
  // Status code may live in run.data.main[0][0].json — depends on response setting.
  const first = run.data?.main?.[0]?.[0];
  const statusCode = first ? (first as Record<string, unknown>).statusCode : undefined;
  return {
    method,
    status: typeof statusCode === "number" ? statusCode : undefined,
    durationMs: run.executionTime,
  };
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Find a webhook node and synthesize the URL the user should POST to.
// n8n exposes webhooks at {baseUrl}/webhook/{path}. The path comes from the
// node's parameters; in some workflow shapes it's parameters.path, in others
// the webhookId acts as path.
export function findWebhookUrl(workflow: N8nWorkflow, baseUrl: string): string | null {
  const webhookNode = findWebhookNode(workflow);
  if (!webhookNode) return null;
  const params = (webhookNode.parameters ?? {}) as Record<string, unknown>;
  const path = (params.path as string) || webhookNode.webhookId || "";
  if (!path) return null;
  return `${baseUrl.replace(/\/+$/, "")}/webhook/${path}`;
}

function findWebhookNode(workflow: N8nWorkflow): N8nNode | undefined {
  return workflow.nodes.find(
    (n) => n.type.endsWith(".webhook") || n.type.endsWith(".Webhook"),
  );
}

// Build a resolver that can substitute {{ ... }} expressions in a template
// against the live runData. Mirrors the small subset of n8n's expression
// surface we hit most: $('NodeName').item.json.PATH and $json.PATH.
//
// Security model: we eval expressions via `new Function()` in the browser
// main thread. The expressions come from the user's own workflow JSON.
// This is a dev tool used by the user on their own data — same trust model
// as opening untrusted code in a browser DevTools console. Failures fall
// back to leaving the raw {{ ... }} text alone, never throw.
export function buildExpressionResolver(
  workflow: N8nWorkflow,
  execution: N8nExecution,
  currentNodeName: string,
): (template: string) => string {
  const runData = execution.data?.resultData?.runData ?? {};
  const predecessors = buildPredecessorMap(workflow);
  const currentInput = extractCurrentInputJson(currentNodeName, runData, predecessors);

  return (template: string) => {
    if (typeof template !== "string") return template;
    const body = template.startsWith("=") ? template.slice(1) : template;
    return body.replace(/\{\{([\s\S]*?)\}\}/g, (match, exprRaw) => {
      const expr = exprRaw.trim();
      try {
        const value = evalNodeExpression(expr, runData, currentInput);
        return stringifyResult(value);
      } catch {
        return match;
      }
    });
  };
}

// Same idea but returns the RAW JS value when the template is a single
// `={{ expr }}` (the common case for IF leftValue/rightValue). Falls back
// to the string-resolver for multi-fragment templates and literals.
export function buildRawResolver(
  workflow: N8nWorkflow,
  execution: N8nExecution,
  currentNodeName: string,
): (template: string) => unknown {
  const runData = execution.data?.resultData?.runData ?? {};
  const predecessors = buildPredecessorMap(workflow);
  const currentInput = extractCurrentInputJson(currentNodeName, runData, predecessors);
  const stringResolver = buildExpressionResolver(workflow, execution, currentNodeName);

  return (template: string) => {
    if (typeof template !== "string") return template;
    const body = template.startsWith("=") ? template.slice(1) : template;
    const single = body.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
    if (single) {
      try {
        return evalNodeExpression(single[1].trim(), runData, currentInput);
      } catch {
        return undefined;
      }
    }
    // Multi-fragment or literal — fall back to the stringified version.
    return stringResolver(template);
  };
}

function evalNodeExpression(
  expr: string,
  runData: Record<string, import("./types").N8nNodeRun[]>,
  currentInput: unknown,
): unknown {
  const $ = (nodeName: string) => makeNodeProxy(nodeName, runData);
  const $json = currentInput;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("$", "$json", `"use strict"; return (${expr});`);
  return fn($, $json);
}

function makeNodeProxy(
  nodeName: string,
  runData: Record<string, import("./types").N8nNodeRun[]>,
) {
  const runs = runData[nodeName];
  if (!runs || !runs[0]) return undefined;
  const items = (runs[0].data?.main?.[0] ?? []) as Array<{ json?: unknown }>;
  const firstJson = items[0]?.json ?? items[0];
  return {
    item: { json: firstJson },
    first: () => ({ json: firstJson }),
    all: () => items.map((i) => ({ json: i?.json ?? i })),
  };
}

function extractCurrentInputJson(
  nodeName: string,
  runData: Record<string, import("./types").N8nNodeRun[]>,
  predecessors: PredecessorMap,
): unknown {
  const preds = predecessors.get(nodeName);
  if (!preds || preds.length === 0) {
    // Trigger node — its own first output is also its "input."
    const first = runData[nodeName]?.[0]?.data?.main?.[0]?.[0];
    return (first as { json?: unknown })?.json ?? first;
  }
  for (const p of preds) {
    const predOutput = runData[p.from]?.[0]?.data?.main?.[p.outputIndex];
    if (Array.isArray(predOutput) && predOutput.length > 0) {
      const first = predOutput[0] as { json?: unknown };
      return first?.json ?? first;
    }
  }
  return undefined;
}

function stringifyResult(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// Pull the input payload from a finished execution. n8n's webhook trigger
// stores the inbound HTTP request as the first run's first output item.
// The shape is { headers, params, query, body } — we want body when it's
// an object (the typical case), otherwise the whole envelope.
export function extractTriggerInput(
  workflow: N8nWorkflow,
  execution: N8nExecution,
): { text: string; json: unknown } | null {
  const runData = execution.data?.resultData?.runData ?? {};

  // Try the source workflow's webhook node name first.
  const sourceWebhook = findWebhookNode(workflow);
  const candidates: string[] = [];
  if (sourceWebhook?.name && runData[sourceWebhook.name]) {
    candidates.push(sourceWebhook.name);
  }

  // Fallback: a test mirror's synthetic webhook is named "Test Trigger"
  // (or the picked unique-name variant). Walk runData and grab whichever
  // entry looks like the trigger run — i.e. the one with no `source`
  // backlinks. The trigger is always upstream of everything else.
  if (candidates.length === 0) {
    for (const [name, runs] of Object.entries(runData)) {
      const firstRun = runs?.[0];
      if (!firstRun) continue;
      const src = (firstRun as { source?: unknown[] }).source;
      if (!src || (Array.isArray(src) && src.length === 0)) {
        candidates.push(name);
      }
    }
  }

  for (const name of candidates) {
    const first = runData[name]?.[0]?.data?.main?.[0]?.[0];
    if (!first || typeof first !== "object") continue;
    const rec = first as Record<string, unknown>;
    const json = rec.json;
    if (json == null) continue;
    // Unwrap `body` if this looks like a webhook envelope; otherwise the
    // trigger output IS the payload (manual / schedule / sub trigger).
    const maybeBody = (json as Record<string, unknown>).body;
    const looksLikeWebhookEnvelope =
      maybeBody &&
      typeof maybeBody === "object" &&
      !Array.isArray(maybeBody) &&
      ("headers" in (json as Record<string, unknown>) ||
        "query" in (json as Record<string, unknown>) ||
        "webhookUrl" in (json as Record<string, unknown>));
    const payload = looksLikeWebhookEnvelope ? maybeBody : json;
    return { text: JSON.stringify(payload, null, 2), json: payload };
  }

  return null;
}
