# n8n-studio

A free, open-source workflow inspector and tester for [n8n](https://n8n.io). Load a workflow, give it an input, hit run — and read the result in a humanely friendly view that n8n itself doesn't provide.

Not affiliated with n8n.io.

## What it does

- **One-screen debugging.** Workflow graph, every node's resolved parameters (after `{{ }}` expressions evaluate), input, output, verdict — all visible without tab-switching.
- **Test mode with safe mirrors.** Flip a toggle and Run sends your input through a transformed copy of the workflow. Every side-effect node (HTTP writes, Gmail/Slack sends, HubSpot writes, …) is replaced by a stub returning a plausible response. Reads, IF/Switch, Code, and respond-to-webhook stay real. No emails sent, no HubSpot rows created — but your routing logic and expressions execute against real upstream data.
- **Smart payload inspection.** HTTP body params with stringified JSON-encoded HTML (HubSpot notes, Gmail messages, …) auto-unwrap and render the HTML inline. Long keys don't wrap, values right-align, deep trees flatten.
- **Re-runnable from past executions.** Replay any historical input against today's workflow.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, hit the gear icon, paste your n8n URL + API key. Pick a workflow, paste input JSON, hit Run.

## Your data stays on your machine

- **No env vars, no backend, no database.** Your n8n URL and API key live in your browser's `localStorage` and never leave the machine running the tool.
- **No telemetry.** No analytics, no error reporting, nothing phones home.
- **Self-hosted by default.** The Next.js API routes only proxy from your browser to your own n8n instance, using the URL and key you typed in. They exist to keep your API key out of the browser network tab and avoid CORS — not to ship anything anywhere.

## Test mode

1. Load a workflow.
2. Click **Test mode** in the header — the canvas gets a pink TEST badge so you can't forget.
3. Paste or pick an input (the past-execution picker is great here — replay any historical input against today's workflow).
4. Hit **▶ Run (test)**.

Under the hood:

- The workflow JSON is fetched from n8n.
- Every node outside the allowlist (triggers, IF/Switch, Filter, Merge, Code, Set, dateTime, respond-to-webhook, HTTP GET, HubSpot search/get/getAll, …) is replaced with a Set node that outputs a plausible JSON stub. HubSpot notes/contacts/associations get URL-aware shapes so downstream `$('Create Call Note').item.json.id` references still resolve.
- The webhook path is suffixed `-test`.
- The mirror is pushed to n8n as `(test) <your workflow name>` and activated. Subsequent runs reuse the same mirror.
- The tool fires the test webhook, polls the execution, and renders the result the same way a normal run does. Verdict shows `Succeeded (test)` / `Error (test)`.

Tear the mirror down anytime: **Settings → Test mode → Delete test mirror**.

Caveats:

- Only Webhook-triggered workflows are supported. Cron/manual triggers surface a friendly error.
- Each tested workflow accumulates one mirror. On n8n cloud's 10-workflow free tier, that halves capacity — delete mirrors you're done with from Settings.
- Stubs are JSON shapes computed at transform time. If a downstream node consumes a field your stub doesn't include, add it to `lib/test-mode/stubs.ts`.
- `executeWorkflow` calls to subworkflows are stubbed (treated as a side effect). Recursive transformation is a v2 problem.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4
- Next.js API routes proxy to n8n (avoids CORS, keeps your API key out of the browser network tab)
- `localStorage` for settings, theme, and per-workflow preferences
- No database. Single-user, single-machine by design.

## License

MIT
