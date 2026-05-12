import { NextResponse } from "next/server";
import { listWorkflows, readCredsFromHeaders } from "@/lib/n8n";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });
  try {
    const workflows = await listWorkflows(creds);
    return NextResponse.json({ workflows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
