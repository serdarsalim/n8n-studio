// Push-or-update the test mirror and tear it down on request.

import {
  activateWorkflow,
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  type N8nCreds,
  updateWorkflow,
} from "@/lib/n8n";
import type { N8nWorkflow } from "@/lib/types";
import { TEST_NAME_PREFIX } from "./transformer";

export async function pushTestWorkflow(
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
