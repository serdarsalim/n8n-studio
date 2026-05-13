// Pure transformer: source workflow → test mirror with side-effect nodes
// replaced by Set stubs and the webhook trigger path suffixed with `-test`.
// The source object is never mutated.

import type { N8nNode, N8nWorkflow } from "@/lib/types";
import { isWriteMethod, isWriteOperation, pickStubShape } from "./stubs";

const TEST_PATH_SUFFIX = "-test";
export const TEST_NAME_PREFIX = "(test) ";

// Node types we leave untouched. These either drive routing/control flow,
// run pure compute, or read external state (safe). Everything else is
// stubbed, including unknown types — better safe than sorry.
const ALLOWLIST_TYPES = new Set([
  // triggers
  "n8n-nodes-base.webhook",
  "n8n-nodes-base.manualTrigger",
  "n8n-nodes-base.cron",
  "n8n-nodes-base.scheduleTrigger",
  // logic / control
  "n8n-nodes-base.if",
  "n8n-nodes-base.switch",
  "n8n-nodes-base.filter",
  "n8n-nodes-base.merge",
  "n8n-nodes-base.splitInBatches",
  "n8n-nodes-base.splitOut",
  "n8n-nodes-base.aggregate",
  "n8n-nodes-base.compareDatasets",
  // compute
  "n8n-nodes-base.code",
  "n8n-nodes-base.set",
  "n8n-nodes-base.function",
  "n8n-nodes-base.functionItem",
  "n8n-nodes-base.dateTime",
  "n8n-nodes-base.crypto",
  "n8n-nodes-base.editFields",
  "n8n-nodes-base.itemLists",
  // flow control / terminators
  "n8n-nodes-base.wait",
  "n8n-nodes-base.noOp",
  "n8n-nodes-base.stopAndError",
  "n8n-nodes-base.respondToWebhook",
  // cosmetic — keep so the editor view of the mirror matches the source
  "n8n-nodes-base.stickyNote",
]);

// HubSpot integration operations that read (don't mutate).
const READ_OPS = /^(get|getall|search|read|list|download|fetch|find)/;

export interface TransformResult {
  workflow: N8nWorkflow;
  stubbedCount: number;
  stubbedNodes: string[];
  webhookNode: N8nNode;
  testWebhookPath: string;
}

export function transformWorkflow(source: N8nWorkflow): TransformResult {
  const webhookNodes = source.nodes.filter(
    (n) =>
      n.type === "n8n-nodes-base.webhook" ||
      n.type.endsWith(".Webhook"),
  );

  if (webhookNodes.length > 0) {
    // First webhook by document order is the firing target; any others
    // (e.g. wait-resume callbacks) still get the -test suffix so they
    // don't collide with prod webhook paths.
    return transformWithExistingWebhook(source, webhookNodes);
  }

  // No webhook trigger — inject a synthetic one so we can fire the workflow.
  const triggerNode = findFallbackTrigger(source);
  if (!triggerNode) {
    throw new Error(
      "This workflow has no trigger node — nothing to fire.",
    );
  }
  return transformWithSyntheticWebhook(source, triggerNode);
}

function transformWithExistingWebhook(
  source: N8nWorkflow,
  webhookNodes: N8nNode[],
): TransformResult {
  const webhookSet = new Set(webhookNodes);
  const primaryWebhook = webhookNodes[0];
  const stubbedNodes: string[] = [];
  const transformedNodes: N8nNode[] = source.nodes.map((node) => {
    if (webhookSet.has(node)) return transformWebhookTrigger(node);
    if (shouldStub(node)) {
      stubbedNodes.push(node.name);
      return stubNode(node);
    }
    return node;
  });

  const originalPath =
    String((primaryWebhook.parameters as Record<string, unknown> | undefined)?.path ?? "") ||
    primaryWebhook.webhookId ||
    "";
  const testPath = `${originalPath}${TEST_PATH_SUFFIX}`;

  const mirror: N8nWorkflow = {
    ...source,
    name: `${TEST_NAME_PREFIX}${source.name}`,
    active: true,
    nodes: transformedNodes,
    connections: source.connections,
  };

  return {
    workflow: mirror,
    stubbedCount: stubbedNodes.length,
    stubbedNodes,
    webhookNode: primaryWebhook,
    testWebhookPath: testPath,
  };
}

// For Manual/Schedule/Cron/etc triggers: prepend a synthetic Webhook node
// (so we can fire externally) and rewrite the original trigger as a Set
// node that unwraps `$json.body` so downstream `$json.foo` /
// `$('Original Trigger Name').item.json.foo` references see the user's
// payload exactly as if the original trigger had produced it.
function transformWithSyntheticWebhook(
  source: N8nWorkflow,
  trigger: N8nNode,
): TransformResult {
  const stubbedNodes: string[] = [];

  // Walk every node EXCEPT the trigger; trigger gets its own rewrite below.
  const baseNodes: N8nNode[] = source.nodes.map((node) => {
    if (node === trigger) return node;
    if (shouldStub(node)) {
      stubbedNodes.push(node.name);
      return stubNode(node);
    }
    return node;
  });

  // Rewrite the original trigger as a Set that emits the webhook body.
  // Preserving id/name/position keeps `$('Trigger Name')` references
  // resolving and the editor view tidy.
  const unwrappedTrigger: N8nNode = {
    ...trigger,
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    parameters: {
      mode: "raw",
      jsonOutput: "={{ $json.body }}",
      options: {},
    },
  };
  // Drop credentials if the original trigger had any.
  delete (unwrappedTrigger as unknown as Record<string, unknown>).credentials;

  // Synthetic webhook lives just left of the original trigger position so
  // the editor view stays readable.
  const [x, y] = trigger.position ?? [0, 0];
  const testPath = synthPathFor(source, trigger);
  const syntheticWebhookName = pickUniqueName(source, "Test Trigger");
  const syntheticWebhook: N8nNode = {
    id: `synthetic-webhook-${randomSuffix()}`,
    name: syntheticWebhookName,
    type: "n8n-nodes-base.webhook",
    typeVersion: 2,
    position: [x - 220, y],
    parameters: {
      httpMethod: "POST",
      path: testPath,
      responseMode: "lastNode",
      options: {},
    },
    webhookId: testPath,
  };

  const nodes: N8nNode[] = [
    syntheticWebhook,
    ...baseNodes.map((n) => (n.name === trigger.name ? unwrappedTrigger : n)),
  ];

  // Connect: synthetic webhook → unwrapped trigger. Everything else stays.
  const connections: Record<string, unknown> = {
    ...(source.connections ?? {}),
    [syntheticWebhookName]: {
      main: [[{ node: trigger.name, type: "main", index: 0 }]],
    },
  };

  const mirror: N8nWorkflow = {
    ...source,
    name: `${TEST_NAME_PREFIX}${source.name}`,
    active: true,
    nodes,
    connections,
  };

  return {
    workflow: mirror,
    stubbedCount: stubbedNodes.length,
    stubbedNodes,
    webhookNode: syntheticWebhook,
    testWebhookPath: testPath,
  };
}

function findFallbackTrigger(source: N8nWorkflow): N8nNode | undefined {
  // A trigger is a non-disabled, non-cosmetic node with no incoming edges.
  // If multiple, prefer manualTrigger > scheduleTrigger > anything else.
  const inDegree = new Map<string, number>();
  for (const n of source.nodes) inDegree.set(n.name, 0);
  const conns = (source.connections ?? {}) as Record<
    string,
    { main?: Array<Array<{ node: string }>> } | undefined
  >;
  for (const fromName of Object.keys(conns)) {
    const branches = conns[fromName]?.main ?? [];
    for (const branch of branches) {
      for (const t of branch ?? []) {
        if (inDegree.has(t.node)) inDegree.set(t.node, (inDegree.get(t.node) ?? 0) + 1);
      }
    }
  }
  const candidates = source.nodes.filter(
    (n) =>
      !n.disabled &&
      !isCosmetic(n.type) &&
      (inDegree.get(n.name) ?? 0) === 0,
  );
  const score = (n: N8nNode): number => {
    if (n.type === "n8n-nodes-base.manualTrigger") return 3;
    if (n.type === "n8n-nodes-base.scheduleTrigger" || n.type === "n8n-nodes-base.cron") return 2;
    if (n.type.toLowerCase().endsWith("trigger")) return 1;
    return 0;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0];
}

function isCosmetic(type: string): boolean {
  return type.endsWith(".stickyNote") || type.endsWith(".StickyNote");
}

function synthPathFor(source: N8nWorkflow, trigger: N8nNode): string {
  const slug = (source.name || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug}-${trigger.name.replace(/\s+/g, "-").toLowerCase()}${TEST_PATH_SUFFIX}`;
}

function pickUniqueName(source: N8nWorkflow, base: string): string {
  const taken = new Set(source.nodes.map((n) => n.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function shouldStub(node: N8nNode): boolean {
  if (node.disabled) return false;

  // Wait nodes with external resume hang the workflow waiting for a real
  // webhook callback — nothing in test mode is going to fire that. Stub
  // them so the flow continues. Time-based waits stay real (and short).
  if (node.type === "n8n-nodes-base.wait") {
    return isExternalResumeWait(node);
  }

  // LangChain / AI calls cost money even for "reads" (LLM tokens, vector
  // DB queries). Always stub.
  if (node.type.includes("n8n-nodes-langchain.")) return true;

  if (ALLOWLIST_TYPES.has(node.type)) return false;

  // HTTP: only stub write methods. GET/HEAD/OPTIONS stay (real reads).
  if (node.type === "n8n-nodes-base.httpRequest") {
    return isWriteMethod(node);
  }

  // SQL databases: stub writes and write-intent raw queries; reads stay
  // real (cheap, side-effect-free).
  if (node.type === "n8n-nodes-base.postgres" ||
      node.type === "n8n-nodes-base.mySql" ||
      node.type === "n8n-nodes-base.microsoftSql" ||
      node.type === "n8n-nodes-base.mssql") {
    if (isWriteOperation(node)) return true;
    return isExecuteQueryWriteIntent(node);
  }

  // Integration nodes: stub if the operation is a write, keep if read.
  if (looksLikeIntegration(node) && isReadOperation(node)) {
    return false;
  }

  // Anything else outside the allowlist → stub it. Safer to stub an
  // unknown node than to let it fire a real side effect.
  return true;
}

function isExecuteQueryWriteIntent(node: N8nNode): boolean {
  const op = String(node.parameters?.operation ?? "").toLowerCase();
  if (op !== "executequery" && op !== "execute") return false;
  const sql = String(node.parameters?.query ?? "").trim().toLowerCase();
  if (!sql) return true; // can't tell — stub to be safe
  return /^(insert|update|delete|create|drop|alter|truncate|merge|replace|grant|revoke)/.test(
    sql,
  );
}

function isExternalResumeWait(node: N8nNode): boolean {
  const resume = String(node.parameters?.resume ?? "").toLowerCase();
  return resume === "webhook" || resume === "form";
}

function looksLikeIntegration(node: N8nNode): boolean {
  // Base nodes plus common community-node prefixes (LangChain bundle,
  // org-scoped packages). We use the same read-op heuristic for all.
  const t = node.type;
  if (ALLOWLIST_TYPES.has(t)) return false;
  return (
    t.startsWith("n8n-nodes-base.") ||
    t.startsWith("@n8n/n8n-nodes-") ||
    t.includes("n8n-nodes-langchain.")
  );
}

function isReadOperation(node: N8nNode): boolean {
  // If a non-write op or no op at all (some read-only nodes like
  // hubspot.search don't set operation), and not a write operation.
  if (isWriteOperation(node)) return false;
  const op = String(node.parameters?.operation ?? "").toLowerCase();
  if (op && READ_OPS.test(op)) return true;
  // Special-case: HubSpot resource:search comes through with op "search".
  // Already covered by READ_OPS above. Without an explicit op we default
  // to "treat as write" so an unknown integration node still gets stubbed.
  return false;
}

function transformWebhookTrigger(node: N8nNode): N8nNode {
  const params = (node.parameters ?? {}) as Record<string, unknown>;
  const originalPath = String(params.path ?? "") || node.webhookId || "";
  const nextParams = { ...params, path: `${originalPath}${TEST_PATH_SUFFIX}` };
  return {
    ...node,
    parameters: nextParams,
    webhookId: node.webhookId
      ? `${node.webhookId}${TEST_PATH_SUFFIX}`
      : node.webhookId,
  };
}

function stubNode(node: N8nNode): N8nNode {
  const shape = pickStubShape(node);
  // Strip credentials so the Set node doesn't carry over auth fields
  // n8n would warn about. continueOnFail is harmless either way.
  // We DO preserve id, name, position so $('Node X') references resolve
  // and the visual layout matches the source workflow.
  const cleaned: Record<string, unknown> = { ...(node as unknown as Record<string, unknown>) };
  delete cleaned.credentials;
  return {
    ...(cleaned as unknown as N8nNode),
    type: "n8n-nodes-base.set",
    typeVersion: 3.4,
    parameters: {
      mode: "raw",
      jsonOutput: JSON.stringify(shape, null, 2),
      options: {},
    },
  };
}
