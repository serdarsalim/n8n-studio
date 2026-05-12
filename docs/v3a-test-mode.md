# v3a — Auto-stub test mode

> **Status:** designed, not implemented. This doc is the implementation spec for the next agent.

## Goal

Run any input (current, manual, or pulled from a past execution) against the workflow **as it stands today**, with zero real side effects (no writes, no emails, no third-party calls), **without requiring the user to instrument the workflow**.

This is the answer to: *"What would today's workflow do with this old payload?"* — the use case that broke open when we found execution #52789 (HubSpot 400 because the old workflow had no Build Properties Map guard) and asked how to safely replay it on the new workflow.

## Approach: stub-and-push (NOT a local simulator)

For each test run:

1. **Fetch** the source workflow JSON from n8n.
2. **Transform** the JSON: replace every side-effect node with a `Set` node that returns a plausible stub response. Keep triggers, IFs, Switches, Code, reads, and flow-control nodes untouched.
3. **Push** the transformed workflow to the user's n8n instance as a parallel test mirror (`(test) <workflow name>`). If it already exists, update it.
4. **Activate** the test workflow.
5. **Fire** its webhook (path-suffixed `-test`) with the chosen input.
6. **Poll** for the execution, same as the current Run flow.
7. **Render** the result in our existing detail view.

The user's source workflow is **never touched**. The test mirror is regenerated from the source on every test run, so drift is impossible.

### Why not a local simulator (v3 from AGENTS.md)?

A local simulator means building per-node-type executors, an expression evaluator, and a record/replay layer for reads. Best case: 1+ week. Worst case: ongoing maintenance forever as n8n adds node types.

Stub-and-push reuses n8n's real engine. Cost: ~1–2 days. New node types stub automatically. Real reads stay real (downstream logic sees accurate upstream data). Only the writes are no-ops.

If the auto-stub approach starts feeling limiting later (complex stub shapes needed, accumulating test mirrors in n8n), v3-true-simulator is the v4 we'd reach for.

---

## Transformer rules

The transformer is a pure function:

```ts
transformWorkflow(source: N8nWorkflow, stubs: Stub[]): N8nWorkflow
```

It walks every node and decides: keep as-is, or replace with a Set stub.

### Allowlist (kept as-is, executes for real)

| Category | Node types |
|---|---|
| Triggers | `webhook`, `manualTrigger`, `cron`, `scheduleTrigger` (only `webhook` is supported for firing in v1) |
| Logic | `if`, `switch`, `filter`, `merge`, `splitInBatches`, `splitOut`, `aggregate`, `compareDatasets` |
| Compute | `code`, `set`, `function`, `functionItem`, `dateTime`, `crypto`, `editFields`, `itemLists` |
| Flow control | `wait`, `noOp`, `stopAndError`, `respondToWebhook` |
| HTTP reads | `httpRequest` where `parameters.method ∈ {GET, HEAD, OPTIONS}` (case-insensitive) |
| Integration reads | Integration nodes with read-like `operation` (`get`, `getAll`, `search`, `read`, `list`, `download`, `fetch`) — examples: HubSpot search, Notion get, Airtable list, Stripe retrieve |

### Stub list (replaced with Set returning stub shape)

| Category | Node types | Notes |
|---|---|---|
| HTTP writes | `httpRequest` where method ∈ {POST, PUT, PATCH, DELETE} | URL-aware stubs for HubSpot patterns |
| Email | `gmail` (send), `email-send`, `sendGrid`, `mailgun` | Return `{ id, threadId, labelIds }` |
| Messaging | `slack`, `discord`, `telegram`, `whatsapp`, `microsoftTeams` | Return `{ ok: true, ts, channel }` etc. |
| CRM writes | `hubspot` (create/update/upsert/delete), `salesforce`, `pipedrive` | Return `{ id, properties, createdAt, updatedAt }` |
| Notes/Docs writes | `notion` (append/update/create), `googleDocs`, `confluence` | |
| Spreadsheet writes | `airtable` (create/update/upsert), `googleSheets` (append/update) | |
| Payment | `stripe` (any write), `paypal` | |
| Storage writes | `s3` (upload), `googleDrive` (upload/move), `dropbox` | |
| File system writes | `writeBinaryFile`, `readWriteFile` (write mode) | |
| **Fallback** | Any node not in the allowlist | Stub with generic shape — better safe than sorry |

### Per-node transformation

For each side-effect node, mutate the node object in the workflow JSON:

```
Before:
  {
    id: "dc42640d-...",
    name: "Update Contact Properties",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.1,
    position: [14416, 9528],
    parameters: { method: "PATCH", url: "={{ ... }}", sendBody: true, bodyParameters: {...}, ... },
    credentials: { hubspotAppToken: { id: "onob...", name: "..." } },
    continueOnFail: true
  }

After:
  {
    id: "dc42640d-...",                           // KEEP — preserves $('Node X') references
    name: "Update Contact Properties",            // KEEP
    type: "n8n-nodes-base.set",                   // CHANGED
    typeVersion: 3.4,                             // bump to current Set version
    position: [14416, 9528],                      // KEEP
    parameters: {
      mode: "raw",
      jsonOutput: '={\n  "id": "stub-contact-{{ $randomString() }}",\n  "properties": {},\n  ...\n}',
      options: {}
    },
    // credentials REMOVED
    // continueOnFail REMOVED (or kept, harmless)
  }
```

Critical: **keep `id`, `name`, `position`** so:
- Other nodes' `$('Update Contact Properties').item.json.id` expressions still resolve (n8n looks up nodes by name).
- The visual layout in the n8n editor matches the source (good for debugging).

### Trigger transformation

Only `webhook` triggers are supported in v1. Modify:
- `parameters.path`: append `-test` (e.g. `synthflow-call-ended` → `synthflow-call-ended-test`)
- `webhookId`: append `-test`

Our app fires the suffixed path. Production webhook is untouched.

For non-webhook triggers, fail with: *"Test mode currently supports webhook-triggered workflows only. This workflow uses {triggerType}."*

### Workflow-level changes

```
name: "Synthflow → HubSpot Sync"  →  "(test) Synthflow → HubSpot Sync"
active: <whatever>                →  true (we'll activate it explicitly)
```

Keep `connections` intact — they reference nodes by name, and we preserved names. Keep `settings`. Keep `staticData` (probably empty anyway).

---

## Stub registry

`lib/test-mode/stubs.ts`:

```ts
import type { N8nNode } from "@/lib/types";

export interface Stub {
  matches(node: N8nNode): boolean;
  /** Returns the JSON-stringifiable object the stub should output. */
  shape(node: N8nNode): unknown;
}

const randomId = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

export const STUBS: Stub[] = [
  // ─── HubSpot HTTP calls (URL-aware) ────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/notes"),
    shape: () => ({
      id: `note-stub-${randomId()}`,
      properties: { hs_createdate: nowIso(), hs_lastmodifieddate: nowIso() },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
    }),
  },
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/contacts"),
    shape: () => ({
      id: `contact-stub-${randomId()}`,
      properties: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
    }),
  },
  // Note↔contact association PUT (returns minimal shape n8n's actual response uses)
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/notes/") &&
      includesUrl(n, "/associations/"),
    shape: () => ({
      id: `note-stub-${randomId()}`,
      properties: {},
      associations: { contacts: { results: [{ id: `contact-${randomId()}`, type: "note_to_contact" }] } },
    }),
  },

  // ─── HubSpot integration node ──────────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.hubspot" &&
      isWriteOperation(n),
    shape: () => ({
      id: `hubspot-stub-${randomId()}`,
      properties: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }),
  },

  // ─── Gmail send ────────────────────────────────────────────────
  {
    matches: (n) => n.type === "n8n-nodes-base.gmail",
    shape: () => ({
      id: `gmail-stub-${randomId()}`,
      threadId: `thread-stub-${randomId()}`,
      labelIds: ["SENT"],
    }),
  },

  // ─── Slack ─────────────────────────────────────────────────────
  {
    matches: (n) => n.type === "n8n-nodes-base.slack",
    shape: () => ({
      ok: true,
      channel: "stub-channel",
      ts: String(Date.now() / 1000),
      message: { text: "stubbed" },
    }),
  },

  // ─── Discord / Telegram / WhatsApp (generic OK shape) ──────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.discord" ||
      n.type === "n8n-nodes-base.telegram" ||
      n.type === "n8n-nodes-base.whatsapp",
    shape: () => ({ ok: true, id: `msg-stub-${randomId()}` }),
  },

  // ─── Generic HTTP write (final HTTP catch) ─────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n),
    shape: (n) => ({
      stub: true,
      method: stringify(n.parameters?.method ?? "POST"),
      url: stringify(n.parameters?.url ?? ""),
      statusCode: 200,
    }),
  },

  // ─── Generic fallback ──────────────────────────────────────────
  {
    matches: () => true,
    shape: (n) => ({ stub: true, replaced_node: n.name, original_type: n.type }),
  },
];

// ─── helpers ─────────────────────────────────────────────────────
function isWriteMethod(n: N8nNode): boolean {
  const m = String(n.parameters?.method ?? n.parameters?.requestMethod ?? "GET").toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

function includesUrl(n: N8nNode, needle: string): boolean {
  const url = String(n.parameters?.url ?? "");
  return url.includes(needle);
}

function isWriteOperation(n: N8nNode): boolean {
  const op = String(n.parameters?.operation ?? "").toLowerCase();
  return /^(create|update|upsert|delete|insert|append|add|remove)/.test(op);
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
```

**Selection rule:** iterate `STUBS` in order, first `matches() === true` wins. URL-aware patterns come first; generic fallbacks at the end.

---

## Set node parameter shape

The replacement Set node needs to output ONE item with the stub JSON as `json`. Set v3.4+ supports raw JSON mode:

```ts
function makeSetParameters(stubShape: unknown): Record<string, unknown> {
  return {
    mode: "raw",
    jsonOutput: JSON.stringify(stubShape, null, 2),
    options: {},
  };
}
```

If you want fancier (e.g. randomized fields per item), use `mode: "manual"` with assignments. For v1, raw is sufficient.

---

## Test workflow lifecycle

`lib/test-mode/lifecycle.ts`:

```ts
import type { N8nCreds, N8nWorkflow } from "@/lib/types";

export async function pushTestWorkflow(
  creds: N8nCreds,
  transformed: N8nWorkflow,
): Promise<{ id: string }> {
  // 1. Find existing mirror by name
  const list = await listWorkflows(creds);
  const existing = list.find((w) => w.name === transformed.name);

  if (existing) {
    // 2a. Update
    await n8nFetch(creds, `/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify(transformed),
    });
    await activateWorkflow(creds, existing.id);
    return { id: existing.id };
  } else {
    // 2b. Create
    const created = await n8nFetch(creds, "/workflows", {
      method: "POST",
      body: JSON.stringify(transformed),
    });
    await activateWorkflow(creds, created.id);
    return { id: created.id };
  }
}

async function activateWorkflow(creds: N8nCreds, id: string): Promise<void> {
  // n8n's activate endpoint — check version compatibility. Some versions
  // use PATCH /workflows/{id} with { active: true }, newer use the
  // dedicated /activate endpoint.
  try {
    await n8nFetch(creds, `/workflows/${id}/activate`, { method: "POST" });
  } catch {
    await n8nFetch(creds, `/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  }
}
```

Add to `lib/n8n.ts`:
- `createWorkflow(creds, workflow): Promise<{ id: string }>`
- `updateWorkflow(creds, id, workflow): Promise<void>`
- `activateWorkflow(creds, id): Promise<void>`
- (already have `listWorkflows`, `getWorkflow`)

---

## End-to-end test run flow

Add a new `/api/test-run` route (parallels `/api/run`):

```ts
// app/api/test-run/route.ts
export async function POST(req: Request) {
  const creds = readCredsFromHeaders(req.headers);
  if (!creds) return NextResponse.json({ error: "Missing creds" }, { status: 401 });

  const body = await req.json() as { workflowId: string; payload: unknown };

  // 1. Fetch source workflow
  const source = await getWorkflow(creds, body.workflowId);

  // 2. Validate webhook trigger
  const webhookNode = source.nodes.find(n => n.type === "n8n-nodes-base.webhook");
  if (!webhookNode) {
    return NextResponse.json(
      { error: "Test mode requires a webhook trigger." },
      { status: 400 },
    );
  }

  // 3. Transform
  const transformed = transformWorkflow(source, STUBS);

  // 4. Push (create or update)
  const { id: testId } = await pushTestWorkflow(creds, transformed);

  // 5. Compute test webhook URL
  const testPath = `${webhookNode.parameters?.path}-test`;
  const webhookUrl = `${creds.url}/webhook/${testPath}`;

  // 6. Fire webhook
  const firedAt = Date.now();
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body.payload ?? {}),
  });

  // 7. Find execution (same retry loop as /api/run)
  const executionId = await findFreshExecution(creds, testId, firedAt);

  return NextResponse.json({
    ok: true,
    testWorkflowId: testId,
    executionId,
    transformedNodes: countStubbed(source, transformed),
  });
}
```

---

## App UX

### Header — test mode toggle

Add a small toggle next to the Run button:

```
[ Run ▶ ]  [ ⓘ test mode: off ]
```

When on:
- Toggle is highlighted (use `--n8n` color).
- Canvas gets a thin pink border or "TEST" badge so the user can't forget.
- Run button text becomes "▶ Run (test)".

State: `testMode: boolean`, persisted to `localStorage` so it survives refresh (under the existing prefs blob).

### Run flow with test mode

When `testMode === true`, `handleRun` calls a new client helper `apiTestRun(...)` instead of `apiRun(...)`. Otherwise identical:

1. Set `running = true`
2. POST `/api/test-run` with `{ workflowId, payload }`
3. Receive `{ executionId }`, poll `/api/executions/{id}` until finished
4. `applyExecution(exec)` as today — same downstream rendering

### Visual indication of test runs

- Verdict node label: append `(test)` — e.g. `Succeeded (test)`, `Error (test)`.
- Past executions: filter is fine; both test and prod runs show in the same list since they're both in n8n's execution table. Optionally, prefix test-run rows with `[TEST]` based on `workflowId` matching the mirror.

### Settings — "Delete test mirror"

Settings modal gets a new section: **"Test mode"**.
- Button: "Delete test mirror for current workflow"
- Cleanup helper that finds `(test) <name>` and DELETEs it
- Useful for users hitting workflow-count limits on n8n cloud

---

## File plan for the next agent

### New files

| Path | Purpose |
|---|---|
| `lib/test-mode/transformer.ts` | Pure `transformWorkflow(source, stubs) → transformed` |
| `lib/test-mode/stubs.ts` | The STUBS registry + helpers |
| `lib/test-mode/lifecycle.ts` | `pushTestWorkflow`, `activateWorkflow`, `deleteTestMirror` |
| `app/api/test-run/route.ts` | POST endpoint orchestrating the above |

### Modified files

| Path | Change |
|---|---|
| `lib/n8n.ts` | Add `createWorkflow`, `updateWorkflow`, `activateWorkflow`, `deleteWorkflow` |
| `lib/client.ts` | Add `apiTestRun(settings, { workflowId, payload })`; add `testMode` to AppPrefs |
| `app/page.tsx` | Test-mode state, header toggle, route `handleRun` through test-run when toggled; visual badge on canvas |
| `components/modals/settings-modal.tsx` | "Delete test mirror" button section |
| `README.md` | Add a short "Test mode" section |

### Tests / sanity checks

Manual checks the next agent should run before declaring done:

1. **Push a test workflow.** Toggle test mode → load Synthflow → click Run with a fresh payload → verify `(test) Synthflow → HubSpot Sync` appears in n8n's workflows list.
2. **No real side effects.** Check HubSpot — no contact created, no note created. Check Gmail — no email sent.
3. **Replay the broken historical input.** Load execution #52789's input as a fixture → Run in test mode → verify it reaches Create Call Note (stubbed) instead of dying at Update Contact Properties.
4. **Replay #54124's input.** Same — should run cleanly through to Update Possibility (No Budget) (stubbed).
5. **Re-run same test.** Verify the test mirror is reused (no duplicate workflows created).
6. **Source workflow untouched.** Open the production workflow in n8n editor — no changes.
7. **Delete test mirror button works.** From Settings, deletes the test workflow cleanly.

### Build constraints

- Must pass `npm run typecheck` and `npm run build`.
- Must not break any existing behavior when test mode is OFF (default).

---

## Worked example: Synthflow → HubSpot Sync

Walk-through of what gets transformed.

| Node | Stay or stub? | Why |
|---|---|---|
| Receive Synthflow Payload | **trigger transform** | Webhook path gets `-test` suffix |
| Respond OK | **stay** | `respondToWebhook` is allowlisted |
| Verify Shared Token | **stay** | `if` node |
| Reject Invalid Token | **stay** | `stopAndError` is allowlisted (legit terminator) |
| Search Contact by Phone | **stay** | HubSpot `operation: search` is a read |
| Select Contact Match | **stay** | `code` node |
| Build Properties Map | **stay** | `code` node |
| Has Properties? | **stay** | `if` node |
| Update Contact Properties | **STUB** | httpRequest PATCH → hubapi.com/contacts pattern → returns contact-shape stub |
| Create Call Note | **STUB** | httpRequest POST → hubapi.com/notes → returns note-shape stub |
| Associate Note to Contact | **STUB** | httpRequest PUT → notes/.../associations/contacts/... → returns association stub |
| Create Collected Variables Note | **STUB** | Same as Create Call Note |
| Associate Variables Note to Contact | **STUB** | Same as Associate Note to Contact |
| Qualified? | **stay** | `if` node |
| Update Possibility (Qualified) | **STUB** | httpRequest PATCH contacts → contact stub |
| Send Booking Email | **STUB** | Gmail → email stub |
| Budget Starts With No? | **stay** | `if` node |
| Send Budget Email | **STUB** | Gmail → email stub |
| Update Possibility (No Budget) | **STUB** | httpRequest PATCH contacts → contact stub |

Result: **9 nodes stubbed, 10 nodes execute for real** including 1 real HubSpot read (Search Contact). Side effects: zero.

---

## Risks and known limitations

1. **Stub field-shape mismatch.** A downstream node may consume a specific field of a stubbed response. If our stub doesn't include it, downstream produces `undefined` or errors. *Mitigation:* the per-URL HubSpot stubs above cover the Synthflow case. For new patterns, add a stub to the registry.

2. **n8n cloud workflow caps.** Each tested source workflow accumulates one (test) mirror. On n8n cloud free tier (10 workflow limit), this halves capacity for production workflows. *Mitigation:* "Delete test mirror" button in settings; later, automatic cleanup on workflow change.

3. **Webhook path collision.** If the user already has a workflow named `(test) ...` for unrelated reasons, we'd overwrite it. *Mitigation:* use a workflow-id-derived suffix instead: `(test-WNrd4lS0...) Synthflow → HubSpot Sync`. Less pretty but bulletproof.

4. **Workflow being edited during test.** Source workflow could be edited in the n8n UI between our `getWorkflow` and `pushTestWorkflow`. Stale-but-not-catastrophic. Acceptable for a personal tool.

5. **Triggers other than webhook.** Cron / manual / polling triggers aren't supported in v1. Surface a friendly error.

6. **Subworkflows.** If a workflow includes `executeWorkflow` calls to OTHER workflows that themselves have side effects, those aren't stubbed. v1: stub the `executeWorkflow` node entirely (treat it as a side effect). v2: recursive transformer.

7. **n8n API version compatibility.** The `/workflows/{id}/activate` endpoint may not exist in older n8n versions. `lifecycle.ts` falls back to `PATCH active=true`. Test against the user's actual n8n version.

---

## Acceptance criteria for "full working engine"

Minimum:
- [ ] Header toggle for test mode (visible, persists across refresh)
- [ ] Transformer handles HTTP POST/PATCH/PUT/DELETE, Gmail, generic fallback
- [ ] Push-or-update test workflow in n8n (via API)
- [ ] Fire test webhook (path-suffixed), poll execution, render
- [ ] Synthflow workflow can be tested with execution #52789's input and produces a clean result (no HubSpot 400)
- [ ] Source workflow is verifiably untouched after a test run
- [ ] All existing app behavior unchanged when test mode is OFF

Bonus if there's time:
- [ ] Smart per-URL stubs for HubSpot notes/contacts (already specified above)
- [ ] "Delete test mirror" button in Settings
- [ ] Visual "TEST" badge on the canvas when test mode is on
- [ ] README section explaining test mode usage

---

## References for the agent

- Source workflow JSON: open Synthflow → HubSpot Sync in n8n and download, or use `mcp__n8n-mcp-coolify__n8n_get_workflow` with id `WNrd4lS0JnV5ZE9H`.
- Execution that failed pre-fix: `52789` (mode "error", failing node "Update Contact Properties").
- Execution that succeeded on new logic: `54124`.
- Existing run flow for reference: `app/api/run/route.ts`.
- Existing n8n client: `lib/n8n.ts`.
- Existing app shell: `app/page.tsx` (handleRun is the function to fork on `testMode`).
