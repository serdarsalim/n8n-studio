# n8n-flow-tester

A free, open-source workflow tester for n8n. Loads a workflow, takes an input payload, runs it, and shows which nodes fired and how each routing decision resolved — in a humanely readable view that n8n itself doesn't provide.

Status: design locked, build not started.

---

## What this is

n8n already executes workflows. It already exposes execution data via API. But its UI for *reading* an execution is node-by-node, click-each-one, scroll-through-JSON-blobs. That's editor UX — built for someone configuring a workflow, not someone testing one.

This tool is purpose-built for the testing read: paste an input, hit run, glance at the result. Per-condition green/red, clean expandable detail rows, all on one screen. The moat is the UX — n8n's editor can't be this opinionated because it has to serve many jobs at once. A standalone tool with one job can be ruthless about it.

The user already built this exact pattern for their own SaaS (Education State's "Test mode" — test contact + per-condition checks + WILL FIRE/WON'T FIRE verdict). This is porting that idea to n8n.

---

## v1: be a beautiful viewer

**The actual workflow runs in n8n.** We just fetch the execution data and render it clearly.

This collapses the architecture to nothing:
- No simulator
- No expression evaluator
- No node-by-node ports from n8n source
- No record-and-replay
- No license concerns

The tradeoff: real side effects happen on every run. That's acceptable because real n8n workflows that get tested already have test-mode gates (single-contact filters, env flags, etc.). The user's own Synthflow workflow already works this way.

### Flow

1. **Settings** — paste n8n URL + API key, persisted to localStorage.
2. **n8n workflow node** → modal lists workflows from `/workflows`, pick one, store its JSON in app state.
3. **Input node** → modal lets you paste JSON. (Later: load from past execution, saved fixture, file.)
4. **Run button** → POST to the workflow's webhook URL with the input JSON, capture the returned `executionId`, poll `/executions/{id}` until it finishes.
5. **Parse the execution** — every node n8n executed appears in `runData` with its input and output. Missing nodes were skipped.
6. **Render the node-check list:**
   - One row per workflow node.
   - Green ✓ if `runData[node]` exists, red ✗ if it doesn't.
   - For IF / Switch / Filter nodes: pull the resolved condition values from the execution data (n8n already evaluated them — we just display).
   - Expandable detail row shows `leftValue ↔ rightValue ✓/✗` for each condition.
   - For action nodes: HTTP method/status if available.
7. **Result node** label flips to the verdict ("Fired successfully" / "Won't fire").

### What v1 includes

- Settings modal (n8n URL + API key).
- Workflow picker modal (list from n8n).
- Input modal: paste JSON only.
- Run via webhook + poll for execution.
- Node-check list rendered from execution data, with IF detail rows.
- Dark mode toggle (already designed in mock-v3, free to include).

### What v1 does NOT include

- Saved fixtures / "Pick from saved tests" — defer to v2.
- "Pull from past execution" in Input — defer to v2.
- Upload .json file — defer to v2.
- Result modal with history / save / diff — defer to v2.
- "Flip to TRUE" buttons — defer to v2.
- Workflow JSON upload/paste — defer to v2 (v1 only loads from connected n8n).
- Any kind of local simulation, replay, or stub — that's v3.

v1 is the read experience, nothing else. Ship it. Use it on your real Synthflow workflow for a week. Then decide what v2 needs.

### Stack

- Next.js (App Router) + TypeScript + Tailwind.
- Next.js API routes as proxy to n8n (avoid CORS).
- localStorage for settings.
- No database, no Convex.

### Timeline estimate

3-5 days for a working v1 if focused. The hardest part is parsing different n8n node types' execution data shapes correctly — IF v1 vs IF v2 differ, etc. Not conceptually hard, just tedious.

---

## v2: regression-tester polish

Once v1 is in daily use, add the save/replay loop:

- Save fixture: snapshot current input under a name, browsable in Input modal.
- Save baseline: fixture + expected outcome.
- "Pull from past execution" in Input — pick a recent run, reload its input.
- Result modal: this run's verdict + run history list (saved runs, fixture/baseline tags).
- "Vs last" compare: diff two runs' node-check lists, highlight what changed. This is the regression-detection killer feature.
- Upload workflow / paste workflow JSON — for workflows not in the connected n8n instance.

v2 makes the tool a real regression suite. v1 is just a viewer.

---

## v3: local simulation (the moat)

v1 + v2 still rely on n8n actually executing the workflow. That means real side effects, every run. Acceptable when workflows have test gates, but a real limitation otherwise.

v3 is the version where we don't run the workflow in n8n at all. We parse the workflow JSON ourselves, walk the nodes, simulate routing locally, replay reads from captured executions, stub writes. Side-effect-free testing for any workflow.

This is the version that requires the engine work — porting IF / Set / Switch / Filter / Code logic from n8n's source, embedding n8n's expression evaluator, building the record-and-replay layer. License notes apply at this stage (see below).

By v3, we know which node types actually matter from real-world v1+v2 usage. We're not guessing.

---

## UX (locked design)

Three n8n-canvas-style nodes across the top, each click-to-modal:

```
[ Input ] ── [ n8n workflow ] ── [ Result ]
   ↑              ↑                  ↑
   click          click              click
   ↓              ↓                  ↓
   load payload   load workflow      view verdict
```

After loading, each node label shows what's loaded (fixture name, workflow name, verdict). Hero action row below the canvas: `▶ Run`. Below that: the node-check list — clean collapsible rows with chevron + name + ✓/✗, expanded view shows IF conditions and action node details.

Visual reference: `mock-v3.html` — this is the locked design. Build against it.

Settings (gear icon) holds n8n URL + API key. Dark mode toggle (sun/moon) in the header.

---

## License (for later — v3 only)

v1 and v2 talk to n8n via REST API only. No license concerns.

v3 ports node-executor logic from n8n's source. n8n is under the [Sustainable Use License](https://github.com/n8n-io/n8n/blob/master/LICENSE.md):

- ✅ Free open-source distribution of this tool.
- ✅ Importing `n8n-workflow` from npm.
- ✅ Porting IF / Set / Switch logic from `packages/nodes-base/nodes/` (keep copyright headers + add modification notice).
- ❌ Selling as paid SaaS without a commercial license from n8n.

Setup for v3: own code MIT, ported files keep n8n header + "Modified from n8n" notice, top-level NOTICE file points to n8n's repo.

---

## Out of scope (forever)

- Multi-user / hosted SaaS (would need commercial n8n license).
- Editing the workflow itself.
- Authentication / RBAC.
- Replacing n8n's editor.

---

## Decisions log

- **Architecture v1:** real n8n runs the workflow, we visualize the execution data. No simulator until v3.
- **State storage v1:** localStorage. No database until multi-device sync is a real need.
- **Name:** `n8n-flow-tester` for now.
- **Distribution:** free + open-source on GitHub. Self-host or run locally with your own n8n API key.
- **Branding:** credit n8n upfront in README ("not affiliated with n8n.io").
- **Why this isn't competing with n8n:** they're constrained by their editor UX (has to serve building, configuring, debugging at once). A single-purpose testing tool can be ruthless in ways their editor can't. Structural moat, not a feature gap they can close.

---

## Files

- `mock.html` — first design pass (3-column). Historical.
- `mock-v2.html` — second pass (status rail). Historical.
- `mock-v3.html` — **locked design.** Build the real UI against this.
- `n8n-icon.webp` — n8n logo for the workflow node.
- `AGENTS.md` — this file.
- `README.md` — short pointer for the repo.
