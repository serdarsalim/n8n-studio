"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FailureAlerts } from "@/components/failure-alerts";
import { NodeCheckList } from "@/components/node-check-list";
import { WorkflowGraph } from "@/components/workflow-graph";
import { ExecutionsModal } from "@/components/modals/executions-modal";
import { InputModal } from "@/components/modals/input-modal";
import { Btn } from "@/components/modals/modal";
import { WorkflowModal } from "@/components/modals/workflow-modal";
import { WorkflowSidebar } from "@/components/workflow-sidebar";
import {
  activeSettings,
  apiGetExecution,
  apiGetWorkflow,
  apiListExecutions,
  apiRun,
  bumpExecAccess,
  bumpTestCount,
  DEFAULT_PREFS,
  readConnections,
  readPrefs,
  readSession,
  readTheme,
  setTheme,
  writeConnections,
  writeSession,
} from "@/lib/client";
import { useN8nPoller } from "@/lib/use-n8n-poller";
import type { FailedExecution } from "@/components/failure-alerts";
import {
  buildExpressionResolver,
  buildRawResolver,
  extractTriggerInput,
  findWebhookUrl,
  parseExecution,
} from "@/lib/execution";
import type { ConnectionsBlob, N8nExecution, N8nWorkflow, NodeCheck } from "@/lib/types";

type Modal = "workflow" | "input" | "executions" | null;

export default function Page() {
  const [connections, setConnections] = useState<ConnectionsBlob>({
    connections: [],
    activeId: null,
  });
  const settings = useMemo(() => activeSettings(connections), [connections]);
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [failureNotifications, setFailureNotifications] = useState<boolean>(
    DEFAULT_PREFS.failureNotifications,
  );
  const poller = useN8nPoller(connections.connections);

  // Derive today's failed executions from the poller's data. Workflow name
  // comes from the workflow list (also fetched by the poller); fall back to
  // the id if the workflow has been deleted since the execution ran.
  const failures: FailedExecution[] = useMemo(() => {
    if (!failureNotifications) return [];
    // Rolling 24-hour window so a 11pm failure doesn't vanish at midnight.
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const nameByKey = new Map<string, string>();
    for (const w of poller.workflows ?? []) {
      nameByKey.set(`${w.connectionId}:${w.id}`, w.name);
    }
    return poller.executions
      .filter((e) => {
        if (!e.workflowId || !e.startedAt) return false;
        if (e.status !== "error" && e.status !== "canceled") return false;
        const t = Date.parse(e.startedAt);
        return Number.isFinite(t) && t >= cutoffMs;
      })
      .map<FailedExecution>((e) => ({
        executionId: e.id,
        workflowId: e.workflowId!,
        workflowName:
          nameByKey.get(`${e.connectionId}:${e.workflowId}`) ?? `Workflow ${e.workflowId}`,
        connectionId: e.connectionId,
        connectionName: e.connectionName,
        n8nUrl: e.n8nUrl,
        startedAt: e.startedAt!,
        status: e.status ?? "error",
      }))
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  }, [poller.workflows, poller.executions, failureNotifications]);

  const [workflow, setWorkflow] = useState<N8nWorkflow | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputJson, setInputJson] = useState<unknown>({});
  // Currently selected fixture in the input modal. null means the editor
  // is in "Current input" mode (not tied to any saved fixture).
  const [selectedPayloadId, setSelectedPayloadId] = useState<string | null>(null);

  const [execution, setExecution] = useState<N8nExecution | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);

  // Drag-resizable width of the WorkflowGraph pane. Persisted in
  // localStorage; default is a comfortable starting size.
  const [graphPaneWidth, setGraphPaneWidth] = useState<number>(560);
  const [graphDragging, setGraphDragging] = useState(false);

  // Hydrate persisted state.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setConnections(readConnections());
    setDark(readTheme() === "dark");
    const session = readSession();
    setWorkflow(session.workflow);
    setExecution(session.execution);
    setInputText(session.inputText);
    setInputJson(session.inputJson);
    setSelectedPayloadId(session.selectedPayloadId);
    try {
      const w = Number(localStorage.getItem("n8n-ft.graphPane.width"));
      if (Number.isFinite(w) && w >= 120 && w <= 900) setGraphPaneWidth(w);
    } catch {}
    setFailureNotifications(readPrefs().failureNotifications);
    setHydrated(true);
  }, []);

  useEffect(() => {
    const onPrefs = () => setFailureNotifications(readPrefs().failureNotifications);
    window.addEventListener("prefs:changed", onPrefs);
    return () => window.removeEventListener("prefs:changed", onPrefs);
  }, []);

  // Drag-to-resize the workflow graph pane. Listeners on window so the
  // gesture survives the cursor leaving the 6px handle.
  useEffect(() => {
    if (!graphDragging) return;
    const onMove = (e: MouseEvent) => {
      // x measured from the graph aside's left edge; the aside sits
      // to the right of the sidebar + section padding. Use the aside's
      // bounding rect for accurate offset.
      const aside = document.getElementById("graph-pane");
      if (!aside) return;
      const rect = aside.getBoundingClientRect();
      const next = Math.min(900, Math.max(120, e.clientX - rect.left));
      setGraphPaneWidth(next);
    };
    const onUp = () => {
      setGraphDragging(false);
      setGraphPaneWidth((w) => {
        try {
          localStorage.setItem("n8n-ft.graphPane.width", String(w));
        } catch {}
        return w;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [graphDragging]);

  // Persist working state on any change — but only after hydration so we
  // don't overwrite stored values with the empty initial state on mount.
  useEffect(() => {
    if (!hydrated) return;
    writeSession({ workflow, execution, inputText, inputJson, selectedPayloadId });
  }, [hydrated, workflow, execution, inputText, inputJson, selectedPayloadId]);

  const checks: NodeCheck[] = useMemo(
    () => (workflow ? parseExecution(workflow, execution) : []),
    [workflow, execution],
  );

  const executableNodeCount = useMemo(
    () =>
      workflow
        ? workflow.nodes.filter(
            (n) =>
              !n.disabled &&
              !n.type.endsWith(".stickyNote") &&
              !n.type.endsWith(".StickyNote"),
          ).length
        : 0,
    [workflow],
  );

  const fired = checks.filter((c) => c.fired).length;
  // Mirror n8n's execution.status verbatim — never derive. Branching
  // workflows correctly skip the path not taken; that isn't a failure.
  const verdict = ((): { label: string; sub: string; ok: boolean | null } | null => {
    if (!execution) return null;
    const status = execution.status;
    const firedSub = `${fired} of ${checks.length} nodes fired`;
    if (status === "success") return { label: "Succeeded", sub: firedSub, ok: true };
    if (status === "error") {
      const err = execution.data?.resultData?.error;
      const errSub = err?.message
        ? `${err.node?.name ? `${err.node.name}: ` : ""}${err.message}`
        : firedSub;
      return { label: "Error", sub: errSub, ok: false };
    }
    if (status === "canceled") return { label: "Canceled", sub: firedSub, ok: false };
    if (status === "running") return { label: "Running", sub: firedSub, ok: null };
    if (status === "waiting") return { label: "Waiting", sub: firedSub, ok: null };
    if (status === "new") return { label: "Queued", sub: firedSub, ok: null };
    // Unknown status — surface whatever n8n said, don't fake a verdict.
    return { label: status ?? "Unknown", sub: firedSub, ok: null };
  })();

  // Load JUST the input from a past execution, without overwriting the
  // current verdict. Used by the Input modal's recent-executions picker.
  // Throws on failure so the caller can render an inline error.
  const loadInputFromExecution = useCallback(
    async (executionId: string) => {
      if (!workflow) throw new Error("Load a workflow first.");
      const exec = await apiGetExecution(settings, executionId);
      const extracted = extractTriggerInput(workflow, exec);
      if (!extracted) {
        throw new Error(
          `Execution #${executionId} has no trigger input data to load.`,
        );
      }
      setInputText(extracted.text);
      setInputJson(extracted.json);
      // Loaded from an execution — not a saved payload, so clear selection.
      setSelectedPayloadId(null);
    },
    [workflow, settings],
  );

  // Setting an execution should also surface the input that produced it,
  // so the Input node reflects "what made this happen."
  const applyExecution = useCallback(
    (exec: N8nExecution) => {
      setExecution(exec);
      if (!workflow) return;
      const extracted = extractTriggerInput(workflow, exec);
      if (!extracted) return;
      setInputText(extracted.text);
      setInputJson(extracted.json);
      setSelectedPayloadId(null);
    },
    [workflow],
  );

  const handleRun = useCallback(async () => {
    if (!workflow) {
      setRunError("Load a workflow first.");
      return;
    }
    if (!settings.n8nUrl || !settings.apiKey) {
      setRunError("Configure n8n URL and API key in Settings first.");
      return;
    }
    const webhookUrl = findWebhookUrl(workflow, settings.n8nUrl);
    if (!webhookUrl) {
      setRunError("This workflow has no Webhook trigger — can't run it from here yet.");
      return;
    }
    setRunError(null);
    setRunning(true);
    setExecution(null);
    try {
      const result = await apiRun(settings, {
        webhookUrl,
        payload: inputJson,
        workflowId: workflow.id,
      });
      const executionId = result.executionId;
      if (!executionId) {
        setRunError(
          "Webhook fired but n8n didn't surface an execution. Check that the workflow is active and records executions.",
        );
        return;
      }
      // Poll until finished. Bottom panel reflects the result — no modal pop.
      for (let i = 0; i < 60; i++) {
        const exec = await apiGetExecution(settings, executionId);
        if (exec.finished || exec.status === "error" || exec.status === "canceled") {
          applyExecution(exec);
          return;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      setRunError("Execution didn't finish within 60 polls (~48s).");
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }, [workflow, settings, inputJson, applyExecution]);

  // Loads a workflow + auto-applies its latest execution. Pass an explicit
  // `creds` to use a connection other than the currently-active one (for
  // cross-connection picks from the sidebar's "Show all" mode), in which
  // case the caller is responsible for switching `connections.activeId`
  // beforehand so subsequent calls use the right creds.
  const onPickWorkflow = useCallback(
    async (id: string, name: string, creds?: { n8nUrl: string; apiKey: string }) => {
      const s = creds ?? settings;
      try {
        const wf = await apiGetWorkflow(s, id);
        setWorkflow(wf);
        setModal(null);
        setExecution(null);
        setSelectedPayloadId(null);
        setSelectedNodeName(null);
        bumpTestCount(wf.id);

        // Auto-load the latest execution so the user lands on a populated
        // view, not an empty "Awaiting run." Best-effort: if it fails or
        // there are no executions, leave the view empty and stay silent —
        // the user can still load one manually from the executions modal.
        try {
          const list = await apiListExecutions(s, wf.id, 1);
          const latestId = list[0]?.id;
          if (!latestId) return;
          const exec = await apiGetExecution(s, latestId);
          setExecution(exec);
          const extracted = extractTriggerInput(wf, exec);
          if (extracted) {
            setInputText(extracted.text);
            setInputJson(extracted.json);
          }
          bumpExecAccess(wf.id, latestId);
        } catch {
          // Silent — picking the workflow still succeeded.
        }
      } catch (e) {
        setRunError(`Could not load workflow ${name}: ${(e as Error).message}`);
      }
    },
    [settings],
  );

  // Cross-connection pick: switch the active connection, then load the
  // workflow using that connection's creds directly (bypassing state).
  const onPickFromConnection = useCallback(
    async (connectionId: string, workflowId: string, workflowName: string) => {
      const conn = connections.connections.find((c) => c.id === connectionId);
      if (!conn) return;
      const next = { ...connections, activeId: connectionId };
      setConnections(next);
      writeConnections(next);
      await onPickWorkflow(workflowId, workflowName, {
        n8nUrl: conn.n8nUrl,
        apiKey: conn.apiKey,
      });
    },
    [connections, onPickWorkflow],
  );

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    setDark(next === "dark");
    setTheme(next);
  };

  return (
    <main className="flex items-stretch min-h-screen">
      <WorkflowSidebar
        settings={settings}
        connections={connections}
        onSwitchConnection={(id) => {
          const next = { ...connections, activeId: id };
          setConnections(next);
          writeConnections(next);
        }}
        currentId={workflow?.id ?? null}
        onPick={onPickWorkflow}
        onPickFromConnection={onPickFromConnection}
        dark={dark}
        onToggleTheme={toggleTheme}
        statusOverrides={
          workflow && execution?.status
            ? { [workflow.id]: execution.status }
            : undefined
        }
        workflows={poller.workflows}
        lastStatus={poller.lastStatus}
        lastRunAt={poller.lastRunAt}
        failedConnectionIds={poller.failedConnectionIds}
        loading={poller.loading}
        refreshing={poller.refreshing}
        error={poller.error}
        onRefresh={poller.refresh}
      />
      <div className="flex-1 min-w-0 flex flex-col bg-[var(--panel)]">
      <header className="px-4 py-2 bg-[var(--panel)] border-b border-[var(--border)] flex items-center gap-4 sticky top-0 z-20">
        <div className="flex-1 flex items-center justify-center gap-1 min-w-0">
          <CompactNode
            color="blue"
            icon={<Image src="/json-icon.png" alt="json" width={20} height={20} className="invert brightness-200" />}
            label={
              inputText
                ? execution?.startedAt
                  ? `${fmtRelative(execution.startedAt)} | ${fmtExecStarted(execution.startedAt)}`
                  : "Custom JSON input"
                : "No input loaded"
            }
            onClick={() => setModal("input")}
          />
          <CompactArrow />
          <CompactNode
            color="white"
            icon={<Image src="/n8n-icon.webp" alt="n8n" width={24} height={24} className="object-contain" />}
            label={workflow?.name ?? "No workflow loaded"}
            onClick={() => setModal("workflow")}
            glowN8n
          />
          <CompactArrow />
          <CompactNode
            color={
              verdict
                ? verdict.ok === true
                  ? "green"
                  : verdict.ok === false
                    ? "red"
                    : "muted"
                : "muted"
            }
            icon={
              verdict ? (
                verdict.ok === true ? (
                  <CheckSvg small />
                ) : verdict.ok === false ? (
                  <XSvg small />
                ) : (
                  <DotSvg small />
                )
              ) : (
                <DotSvg small />
              )
            }
            label={verdict?.label ?? "Awaiting run"}
            onClick={() => workflow && setModal("executions")}
          />
        </div>
        <div className="flex-shrink-0 flex items-center">
          <FailureAlerts
            failures={failures}
            showAllConnections={connections.connections.length > 1}
          />
        </div>

      </header>


      <section className="px-6 py-5 bg-[var(--panel)] flex-1">
        {runError && (
          <div className="mb-4 text-[13px] text-[var(--red-text)] bg-[var(--red-bg)] px-3 py-2 rounded">
            {runError}
          </div>
        )}
        <div className="flex gap-3 items-start">
          {workflow && checks.length > 0 && (
            <>
              <aside
                id="graph-pane"
                className="flex-shrink-0 sticky top-[60px] self-start border border-[var(--border)] rounded-md bg-[var(--panel-soft)] p-2 relative"
                style={{ width: graphPaneWidth }}
              >
                {(execution || settings.n8nUrl) && (
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                    {execution && <CopyExecutionButton execution={execution} />}
                    {settings.n8nUrl && (
                      <OpenInN8nLink baseUrl={settings.n8nUrl} workflowId={workflow.id} />
                    )}
                  </div>
                )}
                <WorkflowGraph
                  workflow={workflow}
                  checks={checks}
                  selectedName={selectedNodeName}
                  onSelect={setSelectedNodeName}
                />
              </aside>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize workflow graph"
                title="Drag to resize · double-click to reset"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setGraphDragging(true);
                }}
                onDoubleClick={() => {
                  setGraphPaneWidth(560);
                  try {
                    localStorage.setItem("n8n-ft.graphPane.width", "560");
                  } catch {}
                }}
                className={`flex-shrink-0 sticky top-[60px] self-stretch w-[6px] -mx-[3px] cursor-col-resize rounded-full z-10 ${
                  graphDragging ? "bg-[var(--n8n)]/40" : "hover:bg-[var(--n8n)]/30"
                }`}
                style={{ minHeight: "calc(100vh - 6rem)" }}
              />
            </>
          )}
          <div className="flex-1 min-w-0">
            <NodeCheckList
              checks={checks}
              preRun={!execution}
              emptyHint="Load a workflow to start."
              selectedName={selectedNodeName}
              onSelect={setSelectedNodeName}
              buildResolver={
                workflow && execution
                  ? (nodeName) => buildExpressionResolver(workflow, execution, nodeName)
                  : undefined
              }
              buildRawResolver={
                workflow && execution
                  ? (nodeName) => buildRawResolver(workflow, execution, nodeName)
                  : undefined
              }
            />
          </div>
        </div>
      </section>
      </div>

      <WorkflowModal
        open={modal === "workflow"}
        onClose={() => setModal(null)}
        settings={settings}
        onPick={onPickWorkflow}
      />
      <InputModal
        open={modal === "input"}
        onClose={() => setModal(null)}
        workflowId={workflow?.id ?? null}
        settings={settings}
        initialText={inputText}
        selectedPayloadId={selectedPayloadId}
        running={running}
        onChange={(text, parsed) => {
          setInputText(text);
          setInputJson(parsed);
        }}
        onSelectPayload={setSelectedPayloadId}
        onLoadFromExecution={loadInputFromExecution}
        onRun={handleRun}
      />
      <ExecutionsModal
        open={modal === "executions"}
        onClose={() => setModal(null)}
        settings={settings}
        workflowId={workflow?.id ?? null}
        workflowName={workflow?.name ?? ""}
        onPick={async (executionId) => {
          setRunError(null);
          setModal(null);
          try {
            const exec = await apiGetExecution(settings, executionId);
            applyExecution(exec);
            if (workflow) bumpExecAccess(workflow.id, executionId);
          } catch (e) {
            setRunError(`Could not load execution ${executionId}: ${(e as Error).message}`);
          }
        }}
      />
    </main>
  );
}

function OpenInN8nLink({ baseUrl, workflowId }: { baseUrl: string; workflowId: string }) {
  // Strip everything past the origin — users sometimes paste the editor URL
  // (e.g. https://n8n.example.com/home/workflows) but the workflow editor
  // lives at /workflow/<id> on the same host.
  let origin = baseUrl;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = baseUrl.replace(/\/+$/, "");
  }
  const href = `${origin}/workflow/${workflowId}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Open this workflow in n8n"
      aria-label="Open this workflow in n8n"
      className="h-7 px-2 text-[11px] font-medium rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--n8n)] flex items-center gap-1.5 cursor-pointer no-underline flex-shrink-0"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3 h-3"
        aria-hidden
      >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      <span>Open in n8n</span>
    </a>
  );
}

function CopyExecutionButton({ execution }: { execution: N8nExecution }) {
  const [copied, setCopied] = useState(false);

  async function handle() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(execution, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in non-secure contexts; swallow silently.
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      title="Copy execution JSON"
      aria-label="Copy execution JSON"
      className="h-7 px-2 text-[11px] font-medium rounded border border-[var(--border-strong)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--n8n)] flex items-center gap-1.5 cursor-pointer"
    >
      {copied ? (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-[#059669]">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="text-[#059669]">Copied</span>
        </>
      ) : (
        <>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function fmtExecStarted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

// "3m ago", "2h ago", "5d ago" — collapses to "just now" under 60s and to
// "Xmo" / "Xy" past a month so the label stays single-token short.
function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

function CheckSvg({ small }: { small?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`${small ? "w-5 h-5" : "w-9 h-9"} text-white`}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function XSvg({ small }: { small?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`${small ? "w-5 h-5" : "w-9 h-9"} text-white`}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
function DotSvg({ small }: { small?: boolean } = {}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`${small ? "w-4 h-4" : "w-8 h-8"} text-[var(--muted-2)]`}>
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function CompactNode({
  color,
  icon,
  label,
  onClick,
  glowN8n,
}: {
  color: "blue" | "white" | "green" | "red" | "muted";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  glowN8n?: boolean;
}) {
  const bg = {
    blue: "bg-[#2563eb] border-[#1d4ed8]",
    white: "bg-[var(--panel)] border-[var(--border-strong)]",
    green: "bg-[#059669] border-[#047857]",
    red: "bg-[#dc2626] border-[#b91c1c]",
    muted: "bg-[var(--panel)] border-[var(--border-strong)]",
  }[color];
  const ring = glowN8n ? "shadow-[0_0_0_2px_rgba(234,75,113,0.25)]" : "";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[var(--bg)] cursor-pointer min-w-0 max-w-[260px]"
    >
      <span className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${bg} ${ring}`}>
        {icon}
      </span>
      <span className="text-[12px] font-medium truncate">{label}</span>
    </button>
  );
}

function CompactArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted-2)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4 flex-shrink-0"
      aria-hidden
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="14 6 20 12 14 18" />
    </svg>
  );
}
