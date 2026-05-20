"use client";
import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/types";
import {
  type AppPrefs,
  DEFAULT_PREFS,
  apiDeleteTestMirror,
  readPrefs,
  writePrefs,
} from "@/lib/client";
import { Btn, Modal } from "./modal";

export function SettingsModal({
  open,
  onClose,
  initial,
  onSave,
  workflowId,
  workflowName,
}: {
  open: boolean;
  onClose: () => void;
  initial: AppSettings;
  onSave: (s: AppSettings) => void;
  workflowId?: string | null;
  workflowName?: string | null;
}) {
  const [url, setUrl] = useState(initial.n8nUrl);
  const [key, setKey] = useState(initial.apiKey);
  const [prefs, setPrefs] = useState<AppPrefs>(DEFAULT_PREFS);
  const [mirrorState, setMirrorState] = useState<{
    kind: "idle" | "deleting" | "result";
    message?: string;
  }>({ kind: "idle" });

  useEffect(() => {
    if (open) {
      setUrl(initial.n8nUrl);
      setKey(initial.apiKey);
      setPrefs(readPrefs());
      setMirrorState({ kind: "idle" });
    }
  }, [open, initial.n8nUrl, initial.apiKey]);

  const updatePref = <K extends keyof AppPrefs>(k: K, v: AppPrefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    writePrefs(next);
  };

  const handleDeleteMirror = async () => {
    if (!workflowId) return;
    setMirrorState({ kind: "deleting" });
    try {
      const { deleted } = await apiDeleteTestMirror(
        { n8nUrl: url.trim(), apiKey: key.trim() },
        workflowId,
      );
      setMirrorState({
        kind: "result",
        message: deleted
          ? "Test mirror deleted."
          : "No test mirror found for this workflow.",
      });
    } catch (e) {
      setMirrorState({ kind: "result", message: (e as Error).message });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={() => onSave({ n8nUrl: url.trim(), apiKey: key.trim() })}>
            Save
          </Btn>
        </>
      }
    >
      <SectionLabel>Connection</SectionLabel>
      <Field
        label="n8n instance URL"
        help="Where your workflows live. Used to list workflows and pull execution data."
      >
        <input
          type="text"
          className="form-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-n8n-host"
        />
      </Field>
      <Field
        label="n8n API key"
        help="Generate from n8n → Settings → API. Stored locally in your browser."
      >
        <input
          type="password"
          className="form-input"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="n8n_api_…"
        />
      </Field>
      <div className="mb-[14px] -mt-[6px]">
        <button
          type="button"
          onClick={() => {
            setUrl("");
            setKey("");
          }}
          disabled={!url && !key}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--red)] disabled:text-[var(--muted-2)] disabled:cursor-not-allowed cursor-pointer bg-transparent border-0 p-0 underline underline-offset-2"
        >
          Clear connection
        </button>
        <span className="text-[11px] text-[var(--muted-2)] ml-2">
          Wipes the URL and key from this browser. Save to confirm.
        </span>
      </div>

      <SectionLabel className="mt-6">Display preferences</SectionLabel>
      <Toggle
        label="Show node parameters expanded by default"
        checked={prefs.paramsDefaultOpen}
        onChange={(v) => updatePref("paramsDefaultOpen", v)}
      />
      <Field label="Default data view">
        <Segmented
          value={prefs.dataViewDefault}
          onChange={(v) => updatePref("dataViewDefault", v as "table" | "json")}
          options={[
            { value: "table", label: "Table" },
            { value: "json", label: "JSON" },
          ]}
        />
      </Field>
      <Toggle
        label="Show single-item results as a vertical key/value list"
        help="When off, single-item results render as a one-row horizontal table."
        checked={prefs.singleItemAsList}
        onChange={(v) => updatePref("singleItemAsList", v)}
      />

      <SectionLabel className="mt-6">Test mode</SectionLabel>
      <div className="text-[12px] text-[var(--muted)] mb-3 leading-relaxed">
        Test mode runs against a transformed copy of the workflow with every
        side-effect node replaced by a Set stub. The mirror lives in n8n as
        <code className="mx-1 px-1 rounded bg-[var(--panel-soft-2)] text-[var(--text)]">
          (test) {workflowName ?? "<workflow name>"}
        </code>
        and is regenerated from the source on every test run.
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <Btn
          onClick={handleDeleteMirror}
          disabled={!workflowId || mirrorState.kind === "deleting" || !url || !key}
          tooltip={
            !workflowId
              ? "Load a workflow first"
              : !url || !key
                ? "Enter your n8n URL and API key"
                : undefined
          }
        >
          {mirrorState.kind === "deleting" ? "Deleting…" : "Delete test mirror"}
        </Btn>
        {mirrorState.kind === "result" && (
          <span className="text-[12px] text-[var(--muted)]">{mirrorState.message}</span>
        )}
      </div>
      <style>{formInputCss}</style>
    </Modal>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--muted)] mb-2 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-[14px] last:mb-0">
      <label className="block text-[12px] text-[var(--muted)] mb-[6px] font-medium">{label}</label>
      {children}
      {help && <div className="text-[11px] text-[var(--muted-2)] mt-[4px]">{help}</div>}
    </div>
  );
}

function Toggle({
  label,
  help,
  checked,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 mb-[14px] last:mb-0 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] accent-[var(--n8n)] cursor-pointer"
      />
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text)]">{label}</div>
        {help && <div className="text-[11px] text-[var(--muted-2)] mt-[2px]">{help}</div>}
      </div>
    </label>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-[5px] border border-[var(--border-strong)] overflow-hidden">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-[12px] py-[6px] text-[12px] font-medium cursor-pointer border-0 ${
            value === opt.value
              ? "bg-[var(--panel-soft-2)] text-[var(--text)]"
              : "bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const formInputCss = `
.form-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  font-family: var(--mono);
  font-size: 13px;
  outline: none;
}
.form-input:focus { border-color: var(--n8n); }
`;
