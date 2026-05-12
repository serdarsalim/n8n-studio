import { NextResponse } from "next/server";
import { getWorkflow, readCredsFromHeaders } from "@/lib/n8n";
import { deleteTestMirror } from "@/lib/test-mode/lifecycle";

export const dynamic = "force-dynamic";

// DELETE /api/test-mirror?workflowId=...
// Looks up the (test) mirror for the given source workflow and removes it.
export async function DELETE(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  if (!workflowId) {
    return NextResponse.json({ error: "workflowId required" }, { status: 400 });
  }

  try {
    const source = await getWorkflow(creds, workflowId);
    const { deleted } = await deleteTestMirror(creds, source.name);
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
