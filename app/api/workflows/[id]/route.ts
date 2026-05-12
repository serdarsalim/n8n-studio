import { NextResponse } from "next/server";
import { getWorkflow, readCredsFromHeaders } from "@/lib/n8n";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const workflow = await getWorkflow(creds, id);
    return NextResponse.json({ workflow });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
