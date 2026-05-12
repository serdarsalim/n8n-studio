import { NextResponse } from "next/server";
import { listExecutions, readCredsFromHeaders } from "@/lib/n8n";

export const dynamic = "force-dynamic";

// POST /api/run
// body: { webhookUrl: string, payload: unknown, workflowId: string }
//
// n8n's webhook endpoint doesn't return an executionId in its default
// response, so we trigger the webhook, then look up the most recent
// execution for the workflow that started after we fired.
export async function POST(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing n8n credentials" }, { status: 401 });

  let body: { webhookUrl?: string; payload?: unknown; workflowId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { webhookUrl, payload, workflowId } = body;
  if (!webhookUrl || !workflowId) {
    return NextResponse.json({ error: "webhookUrl and workflowId required" }, { status: 400 });
  }

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
        { error: `Webhook returned ${res.status}`, body: webhookResponse },
        { status: 502 },
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Webhook fetch failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }

  // Find the execution this triggered. n8n needs a moment to register it.
  let executionId: string | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const list = await listExecutions(creds, workflowId, 5);
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

  if (!executionId) {
    return NextResponse.json({
      ok: true,
      executionId: null,
      webhookResponse,
      note: "Webhook fired but no matching execution surfaced. The workflow may not record executions, or n8n is slow to register it.",
    });
  }
  return NextResponse.json({ ok: true, executionId, webhookResponse });
}
