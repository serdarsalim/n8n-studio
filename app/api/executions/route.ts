import { NextResponse } from "next/server";
import { listExecutions, readCredsFromHeaders } from "@/lib/n8n";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const workflowId = searchParams.get("workflowId");
  const limit = Number(searchParams.get("limit") ?? "25");
  try {
    const executions = await listExecutions(creds, workflowId, limit);
    return NextResponse.json({ executions });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
