import { NextResponse } from "next/server";
import { getWorkflow, listExecutions, readCredsFromHeaders } from "@/lib/n8n";
import { pushTestWorkflowTree } from "@/lib/test-mode/lifecycle";

export const dynamic = "force-dynamic";

// POST /api/test-run
// body: { workflowId: string, payload: unknown }
//
// Mirrors /api/run, but runs against a transformed copy of the source
// workflow: every side-effect node replaced with a Set stub, webhook path
// suffixed `-test`, and every executeWorkflow reference recursively
// transformed and pushed as its own test mirror. Source workflow is
// never touched.
export async function POST(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });

  let body: { workflowId?: string; payload?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { workflowId, payload } = body;
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId required" }, { status: 400 });
  }

  // 1. Fetch source workflow
  let source;
  try {
    source = await getWorkflow(creds, workflowId);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to fetch source workflow: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // 2. Recursively transform + push (handles executeWorkflow subs too)
  let tree;
  try {
    tree = await pushTestWorkflowTree(creds, source);
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to push test workflow: ${(e as Error).message}` },
      { status: 502 },
    );
  }
  const testWorkflowId = tree.id;
  const created = tree.created;
  const result = tree.result;

  // 3. Compute webhook URL and fire it
  const webhookUrl = `${creds.url}/webhook/${result.testWebhookPath}`;
  const firedAt = Date.now();
  let webhookResponse: unknown = null;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    webhookResponse = await res.json().catch(() => res.text().catch(() => null));
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Test webhook returned ${res.status}`,
          body: webhookResponse,
          testWorkflowId,
          testWebhookPath: result.testWebhookPath,
        },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: `Test webhook fetch failed: ${(e as Error).message}`,
        testWorkflowId,
        testWebhookPath: result.testWebhookPath,
      },
      { status: 502 },
    );
  }

  // 5. Find the fresh execution (same retry loop as /api/run)
  let executionId: string | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const list = await listExecutions(creds, testWorkflowId, 5);
      const fresh = list.find((e) => {
        const t = e.startedAt ? Date.parse(e.startedAt) : 0;
        return t >= firedAt - 1000;
      });
      if (fresh) {
        executionId = fresh.id;
        break;
      }
    } catch {
      // keep retrying
    }
  }

  const subCount = Object.keys(tree.subMirrors).length;
  return NextResponse.json({
    ok: true,
    executionId,
    testWorkflowId,
    testWorkflowCreated: created,
    testWebhookPath: result.testWebhookPath,
    stubbedCount: result.stubbedCount,
    stubbedNodes: result.stubbedNodes,
    subWorkflowMirrorCount: subCount,
    subWorkflowMirrors: tree.subMirrors,
    webhookResponse,
    note: executionId
      ? undefined
      : "Test webhook fired but no matching execution surfaced. The test workflow may not record executions yet.",
  });
}
