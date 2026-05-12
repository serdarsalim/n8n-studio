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
  const webhookNode = source.nodes.find(
    (n) =>
      n.type === "n8n-nodes-base.webhook" ||
      n.type.endsWith(".Webhook"),
  );
  if (!webhookNode) {
    throw new Error(
      "Test mode requires a Webhook trigger. This workflow doesn't have one.",
    );
  }

  const stubbedNodes: string[] = [];
  const transformedNodes: N8nNode[] = source.nodes.map((node) => {
    if (node === webhookNode) return transformWebhookTrigger(node);
    if (shouldStub(node)) {
      stubbedNodes.push(node.name);
      return stubNode(node);
    }
    return node;
  });

  const originalPath =
    String((webhookNode.parameters as Record<string, unknown> | undefined)?.path ?? "") ||
    webhookNode.webhookId ||
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
    webhookNode,
    testWebhookPath: testPath,
  };
}

function shouldStub(node: N8nNode): boolean {
  if (node.disabled) return false;
  if (ALLOWLIST_TYPES.has(node.type)) return false;

  // HTTP: only stub write methods. GET/HEAD/OPTIONS stay (real reads).
  if (node.type === "n8n-nodes-base.httpRequest") {
    return isWriteMethod(node);
  }

  // Integration nodes: stub if the operation is a write, keep if read.
  if (looksLikeIntegration(node) && isReadOperation(node)) {
    return false;
  }

  // Anything else outside the allowlist → stub it. Safer to stub an
  // unknown node than to let it fire a real side effect.
  return true;
}

function looksLikeIntegration(node: N8nNode): boolean {
  return (
    node.type.startsWith("n8n-nodes-base.") &&
    !ALLOWLIST_TYPES.has(node.type)
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
