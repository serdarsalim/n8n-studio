# n8n-flow-tester

A free, open-source workflow tester for [n8n](https://n8n.io). Load a workflow, give it an input, hit run — and read the result in a humanely friendly view that n8n itself doesn't provide.

Not affiliated with n8n.io.

## Status

**v1 build in progress.** Next.js 16 + Tailwind v4 scaffold up, locked UI ported, n8n API proxy wired.

- `AGENTS.md` — full spec, architecture, roadmap.
- `mocks/mock-v3.html` — locked visual design.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, hit the gear icon, paste your n8n URL + API key. Pick a workflow, paste input JSON, hit Run.

## Quick concept

```
[ Input ] ── [ n8n workflow ] ── [ Result ]
```

Click any node to load it. Hit Run. See the per-node green/red verdict on one screen.

**v1:** n8n runs the workflow for real — we fetch the execution data and render it clearly. (Requires a Webhook trigger node and a test-mode gate in your workflow for safety, same pattern you'd use today.)

**v3 (future):** local simulation + record/replay, so workflows without test gates can be tested safely.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4
- Next.js API routes proxy to n8n (avoids CORS, keeps your API key out of the browser network tab)
- `localStorage` for settings and theme
- No database, no Convex (until v2 saved fixtures or multi-device sync earn it)
