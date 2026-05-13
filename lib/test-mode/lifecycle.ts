// Push-or-update the test mirror and tear it down on request.

import {
  activateWorkflow,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflows,
  type N8nCreds,
  updateWorkflow,
} from "@/lib/n8n";
import type { N8nWorkflow } from "@/lib/types";
import {
  extractSubworkflowIds,
  TEST_NAME_PREFIX,
  transformWorkflow,
  type TransformResult,
} from "./transformer";

async function pushTransformed(
  creds: N8nCreds,
  transformed: N8nWorkflow,
): Promise<{ id: string; created: boolean }> {
  const list = await listWorkflows(creds);
  const existing = list.find((w) => w.name === transformed.name);

  if (existing) {
    await updateWorkflow(creds, existing.id, transformed);
    if (!existing.active) await activateWorkflow(creds, existing.id);
    return { id: existing.id, created: false };
  }

  const { id } = await createWorkflow(creds, transformed);
  await activateWorkflow(creds, id);
  return { id, created: true };
}

// Backwards-compatible flat push for callers that don't need recursion.
export async function pushTestWorkflow(
  creds: N8nCreds,
  transformed: N8nWorkflow,
): Promise<{ id: string; created: boolean }> {
  return pushTransformed(creds, transformed);
}

export interface PushTreeResult {
  id: string;
  created: boolean;
  result: TransformResult;
  // source-workflow ID → mirror-workflow ID for every sub we pushed
  // (excluding the root).
  subMirrors: Record<string, string>;
}

interface PushTreeCtx {
  mirrors: Map<string, string>;
  inFlight: Set<string>;
}

const MAX_SUBWORKFLOW_DEPTH = 5;

// Recursively transform + push a workflow and every subworkflow it calls
// via executeWorkflow. Mirrors are deduped by source-workflow ID across
// the whole tree. Cycles short-circuit (the executeWorkflow node stays
// stubbed by the parent transformer). Depth caps at MAX_SUBWORKFLOW_DEPTH
// to keep pathological graphs from running away.
export async function pushTestWorkflowTree(
  creds: N8nCreds,
  source: N8nWorkflow,
): Promise<PushTreeResult> {
  const ctx: PushTreeCtx = { mirrors: new Map(), inFlight: new Set() };
  const root = await pushOne(creds, source, ctx, 0);
  const subMirrors: Record<string, string> = {};
  for (const [src, mirror] of ctx.mirrors) {
    if (src !== source.id) subMirrors[src] = mirror;
  }
  return { ...root, subMirrors };
}

async function pushOne(
  creds: N8nCreds,
  source: N8nWorkflow,
  ctx: PushTreeCtx,
  depth: number,
): Promise<{ id: string; created: boolean; result: TransformResult }> {
  ctx.inFlight.add(source.id);

  // Recurse into referenced subworkflows first so we know their mirror
  // IDs by the time we transform the parent.
  if (depth < MAX_SUBWORKFLOW_DEPTH) {
    const subIds = extractSubworkflowIds(source);
    for (const subId of subIds) {
      if (ctx.mirrors.has(subId)) continue;
      if (ctx.inFlight.has(subId)) continue; // cycle — parent will stub
      try {
        const sub = await getWorkflow(creds, subId);
        await pushOne(creds, sub, ctx, depth + 1);
      } catch {
        // Sub fetch/push failed — leave it for the parent transformer to
        // stub. A missing sub shouldn't sink the whole run.
      }
    }
  }

  // Transform the parent with the populated mirror map, then push.
  const result = transformWorkflow(source, { subMirrors: ctx.mirrors });
  const pushed = await pushTransformed(creds, result.workflow);
  ctx.mirrors.set(source.id, pushed.id);
  ctx.inFlight.delete(source.id);

  return { id: pushed.id, created: pushed.created, result };
}

export async function deleteTestMirror(
  creds: N8nCreds,
  sourceWorkflowName: string,
): Promise<{ deleted: boolean }> {
  const target = `${TEST_NAME_PREFIX}${sourceWorkflowName}`;
  const list = await listWorkflows(creds);
  const mirror = list.find((w) => w.name === target);
  if (!mirror) return { deleted: false };
  await deleteWorkflow(creds, mirror.id);
  return { deleted: true };
}
