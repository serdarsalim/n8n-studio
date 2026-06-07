# n8n-studio

A free, open-source workflow inspector and tester for [n8n](https://n8n.io). Load a workflow, give it an input, hit run — and read the result in a humanely friendly view that n8n itself doesn't provide.

Not affiliated with n8n.io.

## What it does

- **One-screen debugging.** Workflow graph, every node's resolved parameters (after `{{ }}` expressions evaluate), input, output, verdict — all visible without tab-switching.
- **Multiple n8n connections.** Save several instances (prod, dev, self-hosted, cloud) and switch between them from the sidebar.
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
- **Your data never reaches us.** No account, no database, no error reporting. Your keys, workflows, and execution data stay in your browser.
- **Anonymous analytics only.** The hosted version uses Vercel's cookieless, privacy-friendly analytics for page-view counts. No personal data, no cross-site tracking. Self-host to opt out of even that.
- **Self-hosted by default.** The Next.js API routes only proxy from your browser to your own n8n instance, using the URL and key you typed in. They exist to keep your API key out of the browser network tab and avoid CORS — not to ship anything anywhere.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4
- Next.js API routes proxy to n8n (avoids CORS, keeps your API key out of the browser network tab)
- `localStorage` for settings, theme, and per-workflow preferences
- No database. Single-user, single-machine by design.

## License

MIT
