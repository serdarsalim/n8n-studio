"use client";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GearIcon, MoonIcon, SunIcon } from "@/components/icons";
import { NodeCheckList } from "@/components/node-check-list";
import { WorkflowGraph } from "@/components/workflow-graph";
import { ExecutionsModal } from "@/components/modals/executions-modal";
import { InputModal } from "@/components/modals/input-modal";
import { Btn } from "@/components/modals/modal";
import { SettingsModal } from "@/components/modals/settings-modal";
import { WorkflowModal } from "@/components/modals/workflow-modal";
import {
  apiGetExecution,
  apiGetWorkflow,
  apiResolveTestMirror,
  apiRun,
  apiTestRun,
  bumpExecAccess,
  bumpTestCount,
  readPrefs,
  readSession,
  readSettings,
  readTheme,
  setTheme,
  upsertFixtureFromExecution,
  writePrefs,
  writeSession,
  writeSettings,
} from "@/lib/client";
import {
  buildExpressionResolver,
  buildRawResolver,
  extractTriggerInput,
  findWebhookUrl,
  parseExecution,
} from "@/lib/execution";
import type { AppSettings, N8nExecution, N8nWorkflow, NodeCheck } from "@/lib/types";

type Modal = "settings" | "workflow" | "input" | "executions" | null;

export default function Page() {
  const [settings, setSettings] = useState<AppSettings>({ n8nUrl: "", apiKey: "" });
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<Modal>(null);

  const [workflow, setWorkflow] = useState<N8nWorkflow | null>(null);
  const [inputText, setInputText] = useState("");
  const [inputJson, setInputJson] = useState<unknown>({});
  // Currently selected fixture in the input modal. null means the editor
  // is in "Current input" mode (not tied to any saved fixture).
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);

  const [execution, setExecution] = useState<N8nExecution | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedNodeName, setSelectedNodeName] = useState<string | null>(null);
  const [testMode, setTestModeState] = useState(false);
  const [testRunNote, setTestRunNote] = useState<string | null>(null);
  // Mirror workflow ID for the currently-loaded source. Populated after a
  // test run OR by resolving the mirror by name when test mode toggles on.
  // Used to point the Executions modal at test runs instead of prod runs.
  const [testMirrorId, setTestMirrorId] = useState<string | null>(null);

  // Hydrate persisted state.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setSettings(readSettings());
    setDark(readTheme() === "dark");
    const session = readSession();
    setWorkflow(session.workflow);
    setExecution(session.execution);
    setInputText(session.inputText);
    setInputJson(session.inputJson);
    setSelectedFixtureId(session.selectedFixtureId);
    setTestModeState(readPrefs().testMode);
    setHydrated(true);
  }, []);

  const setTestMode = (next: boolean) => {
    setTestModeState(next);
    const current = readPrefs();
    writePrefs({ ...current, testMode: next });
    setTestRunNote(null);
  };

  // Resolve the test mirror ID whenever test mode flips on or the loaded
  // workflow changes. Lets the Executions modal point at the mirror's
  // runs instead of the source workflow's runs.
  useEffect(() => {
    if (!hydrated) return;
    if (!testMode || !workflow || !settings.n8nUrl || !settings.apiKey) {
      setTestMirrorId(null);
      return;
    }
    let cancelled = false;
    apiResolveTestMirror(settings, workflow.name)
      .then(({ id }) => { if (!cancelled) setTestMirrorId(id); })
      .catch(() => { if (!cancelled) setTestMirrorId(null); });
    return () => { cancelled = true; };
  }, [hydrated, testMode, workflow, settings.n8nUrl, settings.apiKey]);

  // Persist working state on any change — but only after hydration so we
  // don't overwrite stored values with the empty initial state on mount.
  useEffect(() => {
    if (!hydrated) return;
    writeSession({ workflow, execution, inputText, inputJson, selectedFixtureId });
  }, [hydrated, workflow, execution, inputText, inputJson, selectedFixtureId]);

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
  // If the execution belongs to a different workflow than the loaded
  // source, it ran against the test mirror — annotate the verdict.
  const ranOnMirror =
    !!execution && !!workflow && execution.workflowId !== workflow.id;
  // Mirror n8n's execution.status verbatim — never derive. Branching
  // workflows correctly skip the path not taken; that isn't a failure.
  const verdict = ((): { label: string; sub: string; ok: boolean | null } | null => {
    if (!execution) return null;
    const status = execution.status;
    const firedSub = `${fired} of ${checks.length} nodes fired`;
    const suffix = ranOnMirror ? " (test)" : "";
    if (status === "success") return { label: `Succeeded${suffix}`, sub: firedSub, ok: true };
    if (status === "error") {
      const err = execution.data?.resultData?.error;
      const errSub = err?.message
        ? `${err.node?.name ? `${err.node.name}: ` : ""}${err.message}`
        : firedSub;
      return { label: `Error${suffix}`, sub: errSub, ok: false };
    }
    if (status === "canceled") return { label: `Canceled${suffix}`, sub: firedSub, ok: false };
    if (status === "running") return { label: `Running${suffix}`, sub: firedSub, ok: null };
    if (status === "waiting") return { label: `Waiting${suffix}`, sub: firedSub, ok: null };
    if (status === "new") return { label: `Queued${suffix}`, sub: firedSub, ok: null };
    // Unknown status — surface whatever n8n said, don't fake a verdict.
    return { label: status ?? "Unknown", sub: firedSub, ok: null };
  })();

  // Load JUST the input from a past execution, without overwriting the
  // current verdict. Used by the Input modal's recent-executions picker.
  const loadInputFromExecution = useCallback(
    async (executionId: string) => {
      if (!workflow) return;
      try {
        const exec = await apiGetExecution(settings, executionId);
        const extracted = extractTriggerInput(workflow, exec);
        if (!extracted) return;
        setInputText(extracted.text);
        setInputJson(extracted.json);
        const fixture = upsertFixtureFromExecution(
          workflow.id,
          exec.id,
          `#${exec.id}`,
          extracted.text,
          extracted.json,
        );
        setSelectedFixtureId(fixture.id);
      } catch (e) {
        setRunError(`Could not load input from execution ${executionId}: ${(e as Error).message}`);
      }
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
      // Auto-save the execution's input as a fixture so it appears in the
      // sidebar. Deduped by executionId — replays don't pile duplicates.
      const fixture = upsertFixtureFromExecution(
        workflow.id,
        exec.id,
        `#${exec.id}`,
        extracted.text,
        extracted.json,
      );
      setSelectedFixtureId(fixture.id);
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
    if (!testMode) {
      const webhookUrl = findWebhookUrl(workflow, settings.n8nUrl);
      if (!webhookUrl) {
        setRunError("This workflow has no Webhook trigger — can't run it from here yet.");
        return;
      }
    }
    setRunError(null);
    setTestRunNote(null);
    setRunning(true);
    setExecution(null);
    try {
      let executionId: string | null;
      if (testMode) {
        const result = await apiTestRun(settings, {
          workflowId: workflow.id,
          payload: inputJson,
        });
        executionId = result.executionId;
        if (result.testWorkflowId) setTestMirrorId(result.testWorkflowId);
        const subNote =
          result.subWorkflowMirrorCount > 0
            ? ` · ${result.subWorkflowMirrorCount} sub-mirror${result.subWorkflowMirrorCount === 1 ? "" : "s"}`
            : "";
        setTestRunNote(
          `Stubbed ${result.stubbedCount} node${result.stubbedCount === 1 ? "" : "s"}` +
            (result.testWorkflowCreated ? " · created test mirror" : " · reused test mirror") +
            subNote,
        );
      } else {
        const webhookUrl = findWebhookUrl(workflow, settings.n8nUrl)!;
        const result = await apiRun(settings, {
          webhookUrl,
          payload: inputJson,
          workflowId: workflow.id,
        });
        executionId = result.executionId;
      }
      if (!executionId) {
        setRunError(
          testMode
            ? "Test webhook fired but n8n didn't surface an execution yet. Check the test mirror is active."
            : "Webhook fired but n8n didn't surface an execution. Check that the workflow is active and records executions.",
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
  }, [workflow, settings, inputJson, testMode, applyExecution]);

  const onPickWorkflow = useCallback(
    async (id: string, name: string) => {
      try {
        const wf = await apiGetWorkflow(settings, id);
        setWorkflow(wf);
        setModal(null);
        setExecution(null);
        setSelectedFixtureId(null);
        setSelectedNodeName(null);
        bumpTestCount(wf.id);
      } catch (e) {
        setRunError(`Could not load workflow ${name}: ${(e as Error).message}`);
      }
    },
    [settings],
  );

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    setDark(next === "dark");
    setTheme(next);
  };

  return (
    <main>
      <header className="px-6 py-3 bg-[var(--panel)] border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h1 className="m-0 text-[15px] font-semibold">n8n-flow-tester</h1>
        <div className="flex items-center gap-2">
          <TestModeToggle on={testMode} onChange={setTestMode} />
          {(() => {
            const disabled = !workflow || !inputText || running;
            const tooltip = !workflow && !inputText
              ? "Load a workflow and paste an input first"
              : !workflow
                ? "Load a workflow first"
                : !inputText
                  ? "Paste an input first"
                  : undefined;
            const label = running ? "Running…" : testMode ? "▶ Run (test)" : "▶ Run";
            return (
              <Btn primary onClick={handleRun} disabled={disabled} tooltip={tooltip}>
                {label}
              </Btn>
            );
          })()}
          <IconBtn onClick={toggleTheme} title="Toggle dark mode">
            {dark ? <SunIcon /> : <MoonIcon />}
          </IconBtn>
          <IconBtn onClick={() => setModal("settings")} title="Settings">
            <GearIcon />
          </IconBtn>
        </div>
      </header>

      <div
        className={`canvas-bg px-8 pt-6 pb-6 flex items-center justify-center border-b border-[var(--border)] relative ${
          testMode ? "ring-2 ring-inset ring-[var(--n8n)]/60" : ""
        }`}
      >
        {testMode && (
          <div className="absolute top-2 left-4 text-[10px] font-semibold tracking-[1px] uppercase px-2 py-[2px] rounded bg-[var(--n8n)] text-white">
            Test mode
          </div>
        )}
        <NodeBlock
          color="blue"
          icon={<Image src="/json-icon.png" alt="json" width={37} height={37} className="invert brightness-200" />}
          label={
            inputText
              ? execution?.startedAt
                ? `Execution · ${fmtExecStarted(execution.startedAt)}`
                : "Custom JSON input"
              : "No input loaded"
          }
          onClick={() => setModal("input")}
          glow
        />
        <Wire />
        <NodeBlock
          color="white"
          icon={<Image src="/n8n-icon.webp" alt="n8n" width={45} height={45} className="object-contain" />}
          label={workflow?.name ?? "No workflow loaded"}
          onClick={() => setModal("workflow")}
          glowN8n
        />
        <Wire />
        <NodeBlock
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
                <CheckSvg />
              ) : verdict.ok === false ? (
                <XSvg />
              ) : (
                <DotSvg />
              )
            ) : (
              <DotSvg />
            )
          }
          label={verdict?.label ?? "Awaiting run"}
          onClick={() => workflow && setModal("executions")}
          glow={!!verdict && verdict.ok !== null}
        />
      </div>


      <section className="px-6 py-5 bg-[var(--panel)] min-h-[60vh]">
        {runError && (
          <div className="mb-4 text-[13px] text-[var(--red-text)] bg-[var(--red-bg)] px-3 py-2 rounded">
            {runError}
          </div>
        )}
        {!runError && testRunNote && (
          <div className="mb-4 text-[12px] text-[var(--muted)] px-3 py-2 rounded border border-[var(--border)] bg-[var(--panel-soft)]">
            Test run · {testRunNote}
          </div>
        )}
        <div className="flex gap-6 items-start">
          {workflow && checks.length > 0 && (
            <aside
              className="flex-shrink-0 sticky top-4 self-start border border-[var(--border)] rounded-md bg-[var(--panel-soft)] p-2"
            >
              <WorkflowGraph
                workflow={workflow}
                checks={checks}
                selectedName={selectedNodeName}
                onSelect={setSelectedNodeName}
              />
            </aside>
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

      <SettingsModal
        open={modal === "settings"}
        onClose={() => setModal(null)}
        initial={settings}
        workflowId={workflow?.id ?? null}
        workflowName={workflow?.name ?? null}
        onSave={(s) => {
          setSettings(s);
          writeSettings(s);
          setModal(null);
        }}
      />
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
        testMirrorId={testMirrorId}
        settings={settings}
        initialText={inputText}
        selectedFixtureId={selectedFixtureId}
        onChange={(text, parsed) => {
          setInputText(text);
          setInputJson(parsed);
        }}
        onSelectFixture={setSelectedFixtureId}
        onLoadFromExecution={loadInputFromExecution}
      />
      <ExecutionsModal
        open={modal === "executions"}
        onClose={() => setModal(null)}
        settings={settings}
        workflowId={testMode ? testMirrorId : (workflow?.id ?? null)}
        workflowName={
          testMode && workflow
            ? `(test) ${workflow.name}`
            : (workflow?.name ?? "")
        }
        emptyHintWhenMissing={
          testMode && !testMirrorId
            ? "No test mirror yet. Run once in test mode to create it."
            : undefined
        }
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

function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-[34px] h-[34px] border-0 bg-transparent text-[var(--muted)] cursor-pointer rounded-md flex items-center justify-center hover:bg-[var(--bg)] hover:text-[var(--text)]"
    >
      {children}
    </button>
  );
}

function TestModeToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      title={
        on
          ? "Test mode ON — runs use a stubbed mirror, no real side effects"
          : "Test mode OFF — runs hit your live workflow"
      }
      className={`h-[34px] px-3 text-[12px] font-medium rounded-md border transition-colors cursor-pointer flex items-center gap-2 ${
        on
          ? "bg-[var(--n8n)] text-white border-[var(--n8n)]"
          : "bg-transparent text-[var(--muted)] border-[var(--border-strong)] hover:text-[var(--text)]"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full ${on ? "bg-white" : "bg-[var(--muted-2)]"}`}
        aria-hidden
      />
      Test mode {on ? "on" : "off"}
    </button>
  );
}

function NodeBlock({
  color,
  icon,
  label,
  onClick,
  glow,
  glowN8n,
}: {
  color: "blue" | "white" | "green" | "red" | "muted";
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  glow?: boolean;
  glowN8n?: boolean;
}) {
  const bg = {
    blue: "bg-[#2563eb] border-[#1d4ed8]",
    white: "bg-[var(--panel)] border-[var(--border-strong)]",
    green: "bg-[#059669] border-[#047857]",
    red: "bg-[#dc2626] border-[#b91c1c]",
    muted: "bg-[var(--panel)] border-[var(--border-strong)]",
  }[color];
  const ring = glowN8n
    ? "shadow-[0_0_0_3px_rgba(234,75,113,0.2),0_6px_16px_rgba(0,0,0,0.1)]"
    : glow
      ? {
          blue: "shadow-[0_0_0_3px_rgba(37,99,235,0.2),0_6px_16px_rgba(0,0,0,0.1)]",
          green: "shadow-[0_0_0_3px_rgba(5,150,105,0.2),0_6px_16px_rgba(0,0,0,0.1)]",
          red: "shadow-[0_0_0_3px_rgba(220,38,38,0.2),0_6px_16px_rgba(0,0,0,0.1)]",
          white: "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.08)]",
          muted: "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.08)]",
        }[color]
      : "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.08)]";

  return (
    <div className="flex flex-col items-center w-[176px]">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`w-[77px] h-[77px] rounded-2xl border flex items-center justify-center cursor-pointer transition-[filter] hover:brightness-110 ${bg} ${ring}`}
      >
        {icon}
      </button>
      <div className="mt-[14px] text-[13px] font-semibold text-center truncate max-w-full">{label}</div>
    </div>
  );
}

function fmtExecStarted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

function Wire() {
  return (
    <div className="w-[80px] h-[2px] bg-[var(--muted-2)] -mt-[34px] -mx-[10px] relative z-[1]">
      <span
        className="absolute -right-[1px] -top-[4px]"
        style={{
          width: 0,
          height: 0,
          borderLeft: "8px solid var(--muted-2)",
          borderTop: "5px solid transparent",
          borderBottom: "5px solid transparent",
        }}
      />
    </div>
  );
}

function CheckSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-white">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
function XSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-9 h-9 text-white">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}
function DotSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-8 h-8 text-[var(--muted-2)]">
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}
