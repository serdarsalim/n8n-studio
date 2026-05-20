"use client";
import { useEffect, useRef, useState } from "react";
import { readPrefs, type AppPrefs } from "@/lib/client";
import type { NodeCheck } from "@/lib/types";
import { JsonTree } from "./json-tree";

function usePrefs(): AppPrefs {
  const [prefs, setPrefs] = useState<AppPrefs>(readPrefs);
  useEffect(() => {
    const onChange = () => setPrefs(readPrefs());
    window.addEventListener("prefs:changed", onChange);
    return () => window.removeEventListener("prefs:changed", onChange);
  }, []);
  return prefs;
}

// Watches the <html> element's `dark` class so children can re-render
// when the theme flips. The class is what our CSS variables key off.
function useDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function NodeDetail({
  check,
  resolve,
  resolveRaw,
}: {
  check: NodeCheck;
  resolve?: (template: string) => string;
  resolveRaw?: (template: string) => unknown;
}) {
  const prefs = usePrefs();
  return (
    <div className="px-[14px] py-[12px] space-y-3">
      <ParametersSection
        check={check}
        defaultOpen={prefs.paramsDefaultOpen}
        resolve={resolve}
        resolveRaw={resolveRaw}
      />
      <div className="grid grid-cols-2 gap-3 min-w-0">
        <DataPane title="INPUT" items={check.inputItems} prefs={prefs} />
        {check.outputBranches && check.outputBranches.length > 1 ? (
          <div className="space-y-3 min-w-0">
            {check.outputBranches.map((b) => (
              <DataPane
                key={b.index}
                title="OUTPUT"
                titleSuffix={`${b.label} branch`}
                items={b.items}
                prefs={prefs}
              />
            ))}
          </div>
        ) : (
          <DataPane
            title="OUTPUT"
            titleSuffix={branchSuffix(check)}
            items={check.outputItems}
            prefs={prefs}
          />
        )}
      </div>
      {check.error && (
        <div className="text-[12px] text-[var(--red-text)] font-mono break-words bg-[var(--red-bg)] px-3 py-2 rounded">
          {check.error}
        </div>
      )}
    </div>
  );
}

function ParametersSection({
  check,
  defaultOpen,
  resolve,
  resolveRaw,
}: {
  check: NodeCheck;
  defaultOpen: boolean;
  resolve?: (template: string) => string;
  resolveRaw?: (template: string) => unknown;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showRaw, setShowRaw] = useState(false);
  const rows = renderParameters(check, resolve, showRaw, resolveRaw);
  if (rows.length === 0) return null;
  // Only show the toggle when there's actually something to flip — i.e.
  // the resolver exists AND at least one parameter value contains a
  // `{{ }}` expression or an `=` prefix. A Code node body (plain JS) has
  // none, so we hide the toggle there.
  const showToggle =
    (!!resolve && hasAnyExpression(check.parameters)) || hasAnyHtml(check.parameters);
  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-[6px] bg-[var(--panel-soft-2)] text-[11px] tracking-[0.5px] uppercase font-semibold text-[var(--muted)]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 text-left bg-transparent border-0 p-0 cursor-pointer text-[var(--muted)] uppercase tracking-[0.5px] text-[11px] font-semibold"
        >
          Parameters
        </button>
        {showToggle && (
          <div className="inline-flex rounded border border-[var(--border)] overflow-hidden normal-case tracking-normal mr-3">
            <button
              type="button"
              onClick={() => setShowRaw(false)}
              className={`text-[10px] uppercase tracking-[0.3px] px-[6px] py-[1px] cursor-pointer border-0 ${
                !showRaw
                  ? "bg-[var(--panel)] text-[var(--text)] font-semibold"
                  : "bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Rendered
            </button>
            <button
              type="button"
              onClick={() => setShowRaw(true)}
              className={`text-[10px] uppercase tracking-[0.3px] px-[6px] py-[1px] cursor-pointer border-0 ${
                showRaw
                  ? "bg-[var(--panel)] text-[var(--text)] font-semibold"
                  : "bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Raw
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="bg-transparent border-0 p-0 cursor-pointer text-[var(--muted)]"
        >
          {open ? "▾" : "▸"}
        </button>
      </div>
      {open && <div className="bg-[var(--panel-soft)] divide-y divide-[var(--border)]">{rows}</div>}
    </div>
  );
}

// Short branch indicator for the OUTPUT pane of an IF/Switch node so the
// user can see at a glance which output index actually carried items
// (INPUT and OUTPUT are otherwise identical for these nodes).
function branchSuffix(check: NodeCheck): string | undefined {
  if (check.branchTaken === undefined) return undefined;
  if (check.branchTaken === "true") return "TRUE branch";
  if (check.branchTaken === "false") return "FALSE branch";
  return `branch ${check.branchTaken}`;
}

function DataPane({
  title,
  titleSuffix,
  items,
  prefs,
}: {
  title: string;
  titleSuffix?: string;
  items: unknown[];
  prefs: AppPrefs;
}) {
  const count = items.length;
  const tableEligible = canRenderAsTable(items);
  const [view, setView] = useState<"json" | "table">(prefs.dataViewDefault);
  const activeView = tableEligible ? view : "json";
  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden min-w-0">
      <div className="flex items-center justify-between px-3 py-[6px] bg-[var(--panel-soft-2)] text-[11px] tracking-[0.5px] uppercase font-semibold text-[var(--muted)]">
        <span>
          {title}
          {titleSuffix && (
            <span className="ml-2 text-[var(--selected-border)] tracking-[0.3px]">
              · {titleSuffix}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2 normal-case tracking-normal">
          <span className="text-[11px] text-[var(--muted-2)] font-mono">
            {count} {count === 1 ? "item" : "items"}
          </span>
          {tableEligible && (
            <div className="inline-flex rounded border border-[var(--border)] overflow-hidden">
              <PaneToggle active={view === "json"} onClick={() => setView("json")}>JSON</PaneToggle>
              <PaneToggle active={view === "table"} onClick={() => setView("table")}>Table</PaneToggle>
            </div>
          )}
          <CopyButton value={items} />
        </div>
      </div>
      <div className="bg-[var(--panel-soft)] px-2 py-2 max-h-[360px] overflow-auto min-w-0">
        {count === 0 ? (
          <div className="text-[12px] text-[var(--muted)] px-2 py-3">No data</div>
        ) : activeView === "table" ? (
          count === 1 && prefs.singleItemAsList ? (
            <SingleItemList item={items[0] as Record<string, unknown>} />
          ) : (
            <ItemsTable items={items as Array<Record<string, unknown>>} />
          )
        ) : count === 1 ? (
          <JsonTree value={items[0]} />
        ) : (
          <JsonTree value={items} />
        )}
      </div>
    </div>
  );
}

function PaneToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] uppercase tracking-[0.3px] px-[6px] py-[1px] cursor-pointer border-0 ${
        active
          ? "bg-[var(--panel)] text-[var(--text)] font-semibold"
          : "bg-transparent text-[var(--muted)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function canRenderAsTable(items: unknown[]): boolean {
  if (items.length === 0) return false;
  return items.every(
    (it) => it !== null && typeof it === "object" && !Array.isArray(it),
  );
}

function SingleItemList({ item }: { item: Record<string, unknown> }) {
  const entries = Object.entries(item);
  if (entries.length === 0) {
    return <div className="text-[12px] text-[var(--muted)] px-2 py-3">No fields</div>;
  }
  return (
    <div className="font-mono text-[12px] divide-y divide-[var(--border)]">
      {entries.map(([k, v]) => (
        <KvRow key={k} k={k} v={v} depth={0} />
      ))}
    </div>
  );
}

// Single key/value row in the SingleItemList. If the value is an object
// or array, the row becomes click-to-expand and renders children inline
// below at +1 indent depth. Arrays of homogenous-shaped objects get an
// extra "table" toggle so a 200-row `leads` array doesn't have to be
// scrolled as 200 expandable [0]/[1]/… rows.
function KvRow({ k, v, depth }: { k: string; v: unknown; depth: number }) {
  const nestable = isNestable(v);
  const [open, setOpen] = useState(false);
  const tableEligible =
    Array.isArray(v) && v.length > 1 && canRenderAsTable(v as unknown[]);
  const [asTable, setAsTable] = useState(tableEligible);
  const keyIndent = depth * 14;
  if (!nestable) {
    return (
      <div className="grid grid-cols-[180px_1fr] gap-3 px-2 py-[6px] min-w-0">
        <div className="text-[var(--muted)] break-words" style={{ paddingLeft: keyIndent }}>
          {k}
        </div>
        <div className="min-w-0 break-words" title={cellTitle(v)}>
          <Cell value={v} />
        </div>
      </div>
    );
  }
  const childEntries = Array.isArray(v)
    ? (v as unknown[]).map((cv, i) => [`[${i}]`, cv] as [string, unknown])
    : Object.entries(v as Record<string, unknown>);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="w-full grid grid-cols-[180px_1fr] gap-3 px-2 py-[6px] min-w-0 cursor-pointer hover:bg-[var(--panel-soft-2)] font-mono text-[12px]"
      >
        <div
          className="text-[var(--muted)] break-words flex items-center gap-1"
          style={{ paddingLeft: keyIndent }}
        >
          <span className="text-[var(--muted-2)] inline-block w-[10px]">{open ? "▾" : "▸"}</span>
          <span>{k}</span>
        </div>
        <div className="min-w-0 break-words text-[var(--muted)] italic flex items-center justify-between gap-2">
          <span className="truncate">{summary(v)}</span>
          {tableEligible && open && (
            <span
              className="inline-flex rounded border border-[var(--border)] overflow-hidden normal-case not-italic"
              onClick={(e) => e.stopPropagation()}
            >
              <PaneToggle active={!asTable} onClick={() => setAsTable(false)}>
                List
              </PaneToggle>
              <PaneToggle active={asTable} onClick={() => setAsTable(true)}>
                Table
              </PaneToggle>
            </span>
          )}
        </div>
      </div>
      {open && tableEligible && asTable && (
        <div className="px-2 pb-2" style={{ paddingLeft: keyIndent + 14 }}>
          <div className="bg-[var(--panel)] border border-[var(--border)] rounded overflow-hidden">
            <ItemsTable items={v as Array<Record<string, unknown>>} />
          </div>
        </div>
      )}
      {open && !(tableEligible && asTable) && (
        <div className="divide-y divide-[var(--border)]">
          {childEntries.map(([ck, cv]) => (
            <KvRow key={ck} k={ck} v={cv} depth={depth + 1} />
          ))}
        </div>
      )}
    </>
  );
}

function isNestable(v: unknown): boolean {
  return v !== null && typeof v === "object";
}

function summary(v: unknown): string {
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (v && typeof v === "object") return `{${Object.keys(v).length}}`;
  return String(v);
}

function ItemsTable({ items }: { items: Array<Record<string, unknown>> }) {
  // Column union, preserving first-seen order across items.
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(it)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-[12px] font-mono">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className="text-left px-2 py-[6px] bg-[var(--panel-soft-2)] text-[var(--muted)] font-semibold border-b border-[var(--border)] whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-[var(--border)] last:border-b-0 align-top">
              {cols.map((c) => (
                <td key={c} className="px-2 py-[6px] max-w-[280px] min-w-0">
                  <TableCell value={it[c]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Table cell that drills in-place when the value is an object/array.
// Collapsed: shows `▸ {N}` / `▸ Array(N)`. Expanded: renders nested
// key/value rows below the chevron, inside the same cell.
function TableCell({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  if (!isNestable(value)) {
    return (
      <div className="truncate" title={cellTitle(value)}>
        <Cell value={value} />
      </div>
    );
  }
  const childEntries = Array.isArray(value)
    ? (value as unknown[]).map((cv, i) => [`[${i}]`, cv] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bg-transparent border-0 p-0 cursor-pointer text-left font-mono text-[12px] text-[var(--muted)] italic hover:text-[var(--text)]"
      >
        <span className="text-[var(--muted-2)] not-italic mr-1">{open ? "▾" : "▸"}</span>
        {summary(value)}
      </button>
      {open && (
        <div className="mt-1 border-l border-[var(--border)] pl-2 divide-y divide-[var(--border)]">
          {childEntries.map(([ck, cv]) => (
            <KvRow key={ck} k={ck} v={cv} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-[var(--muted-2)]">—</span>;
  if (typeof value === "string") return <span className="text-[#047857]">{value}</span>;
  if (typeof value === "number") return <span className="text-[#2563eb]">{value}</span>;
  if (typeof value === "boolean")
    return <span className="text-[var(--n8n)] font-semibold">{String(value)}</span>;
  if (Array.isArray(value))
    return <span className="text-[var(--muted)] italic">Array({value.length})</span>;
  if (typeof value === "object")
    return <span className="text-[var(--muted)] italic">{`{${Object.keys(value).length}}`}</span>;
  return <span>{String(value)}</span>;
}

function cellTitle(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function CopyButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          navigator.clipboard.writeText(JSON.stringify(value, null, 2));
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // ignore
        }
      }}
      className="text-[10px] uppercase tracking-[0.3px] text-[var(--blue)] bg-transparent border border-[var(--border)] hover:border-[var(--blue)] rounded px-[6px] py-[1px] cursor-pointer"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ─── Per-node-type parameter renderers ─────────────────────────────────────

function renderParameters(
  check: NodeCheck,
  resolve: ((template: string) => string) | undefined,
  showRaw: boolean,
  resolveRaw?: (template: string) => unknown,
): React.ReactNode[] {
  const t = check.nodeType;
  if (t.includes("httpRequest") || t.includes("HttpRequest"))
    return renderHttpParams(check, resolve, showRaw);
  if (t.endsWith(".if") || t.endsWith(".If")) return renderConditionParams(check, "IF", resolve, showRaw, resolveRaw);
  if (t.endsWith(".switch") || t.endsWith(".Switch")) return renderConditionParams(check, "Switch", resolve, showRaw, resolveRaw);
  if (t.endsWith(".filter") || t.endsWith(".Filter")) return renderConditionParams(check, "Filter", resolve, showRaw, resolveRaw);
  if (t.endsWith(".code") || t.endsWith(".Code")) return renderCodeParams(check);
  if (t.endsWith(".set") || t.endsWith(".Set")) return renderSetParams(check);
  return renderGenericParams(check, resolve, showRaw);
}

function renderHttpParams(
  check: NodeCheck,
  resolve: ((template: string) => string) | undefined,
  showRaw: boolean,
): React.ReactNode[] {
  const p = check.parameters;
  const method = stringify(p.method ?? p.requestMethod ?? "GET");
  const url = stringify(p.url);
  // Build the full transport-detail rows once. In RAW we emit them in
  // their natural order. In RENDERED we promote `body` to the top and
  // tuck everything else into a collapsed "Request details" group so
  // the eye lands on the payload first.
  const methodRow = <Row key="method" k="method" v={<code>{method}</code>} />;
  const urlRow = url ? (
    <Row key="url" k="url" v={<UrlValue url={url} resolve={resolve} showRaw={showRaw} />} />
  ) : null;
  const authRow = p.authentication ? (
    <Row key="auth" k="authentication" v={<code>{stringify(p.authentication)}</code>} />
  ) : null;
  const queryRow = p.sendQuery ? (
    <Row
      key="q"
      k="sendQuery"
      v={<code>true</code>}
      valueExtra={resolveDeep(p.queryParameters, showRaw ? undefined : resolve)}
    />
  ) : null;
  const headersRow = p.sendHeaders ? (
    <Row
      key="h"
      k="sendHeaders"
      v={<code>true</code>}
      valueExtra={resolveDeep(p.headerParameters, showRaw ? undefined : resolve)}
    />
  ) : null;
  const sendBodyRow = p.sendBody ? <Row key="b" k="sendBody" v={<code>true</code>} /> : null;
  const rawBodyValue = p.sendBody ? (p.body ?? p.jsonBody ?? p.bodyParameters) : undefined;
  // In RENDERED, unwrap n8n's `{parameters: [{name, value}, ...]}`
  // fixedCollection serialization into a plain `{name: value, ...}` so
  // HubSpot/Airtable/etc. bodies don't make you click through an
  // array-of-pairs wrapper just to see the actual fields. RAW keeps the
  // literal structure.
  const bodyValue =
    rawBodyValue !== undefined && !showRaw ? flattenBodyParameters(rawBodyValue) : rawBodyValue;
  const bodyRow =
    bodyValue !== undefined ? (
      <Row
        key="body"
        k="body"
        v={<ParamValue value={bodyValue} resolve={resolve} showRaw={showRaw} />}
      />
    ) : null;
  const optsRow = p.options ? (
    <Row
      key="opts"
      k="options"
      v={<JsonTree value={resolveDeep(p.options, showRaw ? undefined : resolve)} />}
    />
  ) : null;

  if (showRaw) {
    return [methodRow, urlRow, authRow, queryRow, headersRow, sendBodyRow, bodyRow, optsRow].filter(
      Boolean,
    ) as React.ReactNode[];
  }

  // RENDERED: body first, then a collapsed "Request details" group.
  const details = [methodRow, urlRow, authRow, queryRow, headersRow, sendBodyRow, optsRow].filter(
    Boolean,
  ) as React.ReactNode[];
  const rows: React.ReactNode[] = [];
  if (bodyRow) rows.push(bodyRow);
  if (details.length > 0) {
    rows.push(<DetailsGroup key="details" rows={details} />);
  }
  return rows;
}

function hasAnyRenderable(v: unknown): boolean {
  return hasAnyExpression(v) || hasAnyHtml(v);
}

// n8n serializes HTTP node bodyParameters as
// `{ parameters: [{name: "...", value: ...}, ...] }`. In RENDERED we
// unwrap it to `{name: value, ...}` so the user sees their actual
// fields, not the transport wrapper. Returns the input unchanged if
// the shape doesn't match.
function flattenBodyParameters(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== "parameters") return body;
  const arr = obj.parameters;
  if (!Array.isArray(arr) || arr.length === 0) return body;
  const out: Record<string, unknown> = {};
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return body;
    const it = item as Record<string, unknown>;
    if (typeof it.name !== "string") return body;
    out[it.name] = it.value;
  }
  return out;
}

// Collapsible "Request details" wrapper for HTTP params in RENDERED mode.
// Closed by default; one click reveals method/url/auth/headers/etc.
function DetailsGroup({ rows }: { rows: React.ReactNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left px-3 py-[6px] text-[11px] tracking-[0.3px] uppercase text-[var(--muted)] hover:text-[var(--text)] bg-transparent border-0 border-t border-[var(--border)] cursor-pointer flex items-center gap-2"
      >
        <span className="text-[var(--muted-2)] inline-block w-[14px] text-[14px] leading-none">
          {open ? "▾" : "▸"}
        </span>
        <span>Request details</span>
        <span className="text-[var(--muted-2)] normal-case tracking-normal">({rows.length})</span>
      </button>
      {open && <div>{rows}</div>}
    </div>
  );
}

function renderConditionParams(
  check: NodeCheck,
  kind: string,
  resolve: ((template: string) => string) | undefined,
  showRaw: boolean,
  resolveRaw?: (template: string) => unknown,
): React.ReactNode[] {
  if (check.conditions.length === 0) return renderGenericParams(check, undefined, false);
  const rows: React.ReactNode[] = [];
  const summary =
    check.branchTaken !== undefined
      ? `${kind} · ${(check.conditionCombinator ?? "and").toUpperCase()} · took ${kind === "IF" ? (check.branchTaken === "true" ? "TRUE" : "FALSE") : `branch ${check.branchTaken}`} branch`
      : kind;
  rows.push(<Row key="kind" k="type" v={<code>{summary}</code>} />);

  const display = (s: string) => (!showRaw && resolve && hasExpression(s) ? resolve(s) : s);

  check.conditions.forEach((c, i) => {
    // Per-condition pass/fail: actually evaluate the operator on the
    // resolved values instead of mirroring the overall branch result.
    const perPass = evalConditionLocally(c, resolveRaw, c.passed);
    rows.push(
      <Row
        key={`c${i}`}
        k={`condition ${i + 1}`}
        v={
          <div className="font-mono text-[12px] flex items-center gap-2 flex-wrap break-words">
            <span className="break-all">{display(c.leftLabel)}</span>
            <span className="text-[var(--muted-2)]">{operatorLabel(c.operator)}</span>
            {!c.operator?.singleValue && (
              <span className="text-[var(--muted)] break-all">{display(c.rightLabel)}</span>
            )}
            <span className={perPass ? "text-[var(--green)] font-bold" : "text-[var(--red)] font-bold"}>
              {perPass ? "✓" : "✗"}
            </span>
          </div>
        }
      />,
    );
  });
  return rows;
}

function operatorLabel(op?: { type: string; operation: string; singleValue?: boolean }): string {
  if (!op) return "↔";
  switch (op.operation) {
    case "equals": return "=";
    case "notEquals": return "≠";
    case "contains": return "contains";
    case "notContains": return "not contains";
    case "startsWith": return "starts with";
    case "endsWith": return "ends with";
    case "regex":
    case "matches": return "matches";
    case "gt": return ">";
    case "lt": return "<";
    case "gte": return "≥";
    case "lte": return "≤";
    case "true": return "is true";
    case "false": return "is false";
    case "empty":
    case "isEmpty": return "is empty";
    case "notEmpty":
    case "isNotEmpty": return "is not empty";
    case "exists": return "exists";
    case "notExists":
    case "doesNotExist": return "does not exist";
    default: return op.operation;
  }
}

function evalConditionLocally(
  c: import("@/lib/types").ConditionCheck,
  resolveRaw: ((template: string) => unknown) | undefined,
  fallback: boolean,
): boolean {
  if (!resolveRaw || !c.operator) return fallback;
  let left: unknown;
  let right: unknown;
  try {
    left = hasExpression(c.leftLabel) ? resolveRaw(c.leftLabel) : c.leftLabel;
    right = hasExpression(c.rightLabel) ? resolveRaw(c.rightLabel) : c.rightLabel;
  } catch {
    return fallback;
  }
  const op = c.operator.operation;
  try {
    switch (op) {
      case "equals":
        return c.operator.type === "string" ? String(left) === String(right) : left == right;
      case "notEquals":
        return c.operator.type === "string" ? String(left) !== String(right) : left != right;
      case "contains": return String(left ?? "").includes(String(right ?? ""));
      case "notContains": return !String(left ?? "").includes(String(right ?? ""));
      case "startsWith": return String(left ?? "").startsWith(String(right ?? ""));
      case "endsWith": return String(left ?? "").endsWith(String(right ?? ""));
      case "regex":
      case "matches": return new RegExp(String(right ?? "")).test(String(left ?? ""));
      case "gt": return Number(left) > Number(right);
      case "lt": return Number(left) < Number(right);
      case "gte": return Number(left) >= Number(right);
      case "lte": return Number(left) <= Number(right);
      case "true": return left === true || String(left).toLowerCase() === "true";
      case "false": return left === false || String(left).toLowerCase() === "false";
      case "empty":
      case "isEmpty": return left == null || left === "" || (Array.isArray(left) && left.length === 0);
      case "notEmpty":
      case "isNotEmpty": return !(left == null || left === "" || (Array.isArray(left) && left.length === 0));
      case "exists": return left !== undefined && left !== null;
      case "notExists":
      case "doesNotExist": return left === undefined || left === null;
      default: return fallback;
    }
  } catch {
    return fallback;
  }
}

function renderCodeParams(check: NodeCheck): React.ReactNode[] {
  const p = check.parameters;
  const rows: React.ReactNode[] = [];
  if (p.mode) rows.push(<Row key="mode" k="mode" v={<code>{stringify(p.mode)}</code>} />);
  if (p.language) rows.push(<Row key="lang" k="language" v={<code>{stringify(p.language)}</code>} />);
  const code = (p.jsCode as string) || (p.pythonCode as string) || (p.code as string) || "";
  if (code) {
    rows.push(
      <Row
        key="code"
        k="code"
        v={
          <pre className="m-0 font-mono text-[12px] whitespace-pre-wrap break-words bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-2 max-h-[260px] overflow-auto">
            {code}
          </pre>
        }
      />,
    );
  }
  // Anything else: drop in generically.
  for (const [k, v] of Object.entries(p)) {
    if (["mode", "language", "jsCode", "pythonCode", "code"].includes(k)) continue;
    rows.push(<Row key={k} k={k} v={<JsonTree value={v} />} />);
  }
  return rows;
}

function renderSetParams(check: NodeCheck): React.ReactNode[] {
  const p = check.parameters;
  const rows: React.ReactNode[] = [];
  const assignments = (p.assignments as Record<string, unknown> | undefined)?.assignments;
  if (Array.isArray(assignments)) {
    assignments.forEach((a, i) => {
      const r = a as Record<string, unknown>;
      rows.push(
        <Row
          key={`a${i}`}
          k={stringify(r.name) || `assignment ${i + 1}`}
          v={<code className="text-[12px]">{stringify(r.value)}</code>}
        />,
      );
    });
  }
  // Older versions used `values` under specific type buckets.
  const values = p.values as Record<string, unknown> | undefined;
  if (values) {
    for (const [bucket, arr] of Object.entries(values)) {
      if (Array.isArray(arr)) {
        arr.forEach((entry, i) => {
          const r = entry as Record<string, unknown>;
          rows.push(
            <Row
              key={`${bucket}-${i}`}
              k={stringify(r.name) || `${bucket} ${i + 1}`}
              v={<code className="text-[12px]">{stringify(r.value)}</code>}
            />,
          );
        });
      }
    }
  }
  return rows.length > 0 ? rows : renderGenericParams(check, undefined, false);
}

function renderGenericParams(
  check: NodeCheck,
  resolve: ((template: string) => string) | undefined,
  showRaw: boolean,
): React.ReactNode[] {
  return Object.entries(check.parameters).map(([k, v]) => (
    <Row key={k} k={k} v={<ParamValue value={v} resolve={resolve} showRaw={showRaw} />} />
  ));
}

// Smart value renderer driven by section-wide `showRaw`:
//   - HTML strings → iframe (HtmlValue owns the section-wide toggle UI).
//   - Plain strings with `{{ ... }}` expressions → resolved when !showRaw,
//     raw template when showRaw.
//   - Everything else → JSON tree.
function ParamValue({
  value,
  resolve,
  showRaw,
}: {
  value: unknown;
  resolve?: (template: string) => string;
  showRaw: boolean;
}) {
  if (typeof value === "string") {
    // Plain strings AND expression strings render as plain text (no JSON
    // quotes). Expression strings resolve when !showRaw.
    const isExpr = !!resolve && hasExpression(value);
    const display = isExpr && !showRaw ? resolve!(value) : value;
    // Try JSON-string parsing BEFORE the HTML check. JSON-encoded HTML
    // (e.g. HubSpot bodyParameters value with `\"` escapes) must be
    // unwrapped first — otherwise we render the raw JSON text inside the
    // iframe and `\"` survives into href attributes.
    if (!showRaw) {
      const parsed = tryParseJson(display);
      if (parsed !== UNPARSEABLE) {
        if (
          Array.isArray(parsed) &&
          canRenderAsTable(parsed as unknown[]) &&
          parsed.length > 1
        ) {
          return <ItemsTable items={parsed as Array<Record<string, unknown>>} />;
        }
        if (parsed && typeof parsed === "object") {
          // Recurse via ParamTree so any nested HTML string leaves get
          // rendered through ParamValue (iframe preview), not as plain
          // green text via SingleItemList/Cell.
          return <ParamTree value={parsed} resolve={resolve} showRaw={showRaw} depth={0} />;
        }
        return <JsonTree value={parsed} />;
      }
    }
    if (looksLikeHtml(display)) {
      return <HtmlValue value={display} resolve={undefined} showRaw={showRaw} />;
    }
    return (
      <div className="font-mono text-[12px] break-words text-[var(--text)]">{display}</div>
    );
  }
  // Object/array values: walk the tree and defer each string leaf back
  // to ParamValue, so nested HTML / nested JSON-shaped strings render
  // the same way a top-level string would.
  if (value && typeof value === "object") {
    return <ParamTree value={value} resolve={resolve} showRaw={showRaw} depth={0} />;
  }
  return <JsonTree value={value} />;
}

function ParamTree({
  value,
  resolve,
  showRaw,
  depth,
}: {
  value: unknown;
  resolve?: (template: string) => string;
  showRaw: boolean;
  depth: number;
}) {
  if (!value || typeof value !== "object") {
    if (typeof value === "string")
      return <ParamValue value={value} resolve={resolve} showRaw={showRaw} />;
    return <Cell value={value} />;
  }
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  // Single grid wraps all sibling rows so the value column aligns across
  // them (widest key sets the column width). Each row emits its cells
  // directly into this grid via React fragments; nested expansions span
  // both columns and host their own ParamTree grid inside.
  return (
    <div className="grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-[12px]">
      {entries.map(([k, v]) => (
        <ParamTreeRow key={k} k={k} v={v} resolve={resolve} showRaw={showRaw} depth={depth} />
      ))}
    </div>
  );
}

function ParamTreeRow({
  k,
  v,
  resolve,
  showRaw,
  depth,
}: {
  k: string;
  v: unknown;
  resolve?: (template: string) => string;
  showRaw: boolean;
  depth: number;
}) {
  const nestable = v !== null && typeof v === "object";
  // RENDERED auto-expands the whole tree so users see resolved values
  // immediately; RAW keeps the click-to-drill behavior past depth 0.
  const [open, setOpen] = useState(!showRaw || depth < 1);
  const indent = depth * 8;
  if (!nestable) {
    // HTML iframe leaves get a stacked, full-width layout so the preview
    // isn't squeezed into a narrow value column at deep indent levels.
    if (typeof v === "string" && !showRaw && hasAnyHtml(v)) {
      return (
        <div className="col-span-2 px-2 py-[6px] min-w-0 border-b border-[var(--border)] last:border-b-0">
          <div className="text-[var(--muted)] break-words mb-1" style={{ paddingLeft: indent }}>
            {k}
          </div>
          <div className="min-w-0">
            <ParamValue value={v} resolve={resolve} showRaw={showRaw} />
          </div>
        </div>
      );
    }
    return (
      <>
        <div
          className="text-[var(--muted)] whitespace-nowrap py-[6px] pl-2 border-b border-[var(--border)] [&:nth-last-child(2)]:border-b-0"
          style={{ paddingLeft: indent + 8 }}
        >
          {k}
        </div>
        <div className="min-w-0 break-words py-[6px] pr-2 border-b border-[var(--border)] last:border-b-0">
          {typeof v === "string" ? (
            <ParamValue value={v} resolve={resolve} showRaw={showRaw} />
          ) : (
            <Cell value={v} />
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="col-span-2 grid grid-cols-subgrid gap-x-3 px-2 py-[6px] min-w-0 cursor-pointer hover:bg-[var(--panel-soft-2)] border-b border-[var(--border)] last:border-b-0"
      >
        <div
          className="text-[var(--muted)] whitespace-nowrap flex items-center gap-1"
          style={{ paddingLeft: indent }}
        >
          <span className="text-[var(--muted-2)] inline-block w-[10px]">{open ? "▾" : "▸"}</span>
          <span>{k}</span>
        </div>
        <div className="min-w-0 break-words text-[var(--muted)] italic">{summary(v)}</div>
      </div>
      {open && (
        <div className="col-span-2">
          <ParamTree value={v} resolve={resolve} showRaw={showRaw} depth={depth + 1} />
        </div>
      )}
    </>
  );
}

function hasAnyHtml(value: unknown): boolean {
  if (typeof value === "string") {
    if (looksLikeHtml(value)) return true;
    // JSON-shaped string that contains HTML inside one of its fields.
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return hasAnyHtml(JSON.parse(trimmed));
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(hasAnyHtml);
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).some(hasAnyHtml);
  return false;
}

const UNPARSEABLE = Symbol("unparseable");

// Looser JSON parse: only try if the string looks like an object/array,
// and only return the parsed value if it's a non-trivial structure.
// Avoids over-eagerly turning short strings like "5" into bare numbers.
function tryParseJson(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed.length < 2) return UNPARSEABLE;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return UNPARSEABLE;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed;
    return UNPARSEABLE;
  } catch {
    return UNPARSEABLE;
  }
}

// Walk a value tree and replace any string with {{ ... }} expressions
// with its resolved value. Returns a new value — original is untouched.
function resolveDeep(value: unknown, resolve?: (template: string) => string): unknown {
  if (!resolve) return value;
  if (typeof value === "string") return hasExpression(value) ? resolve(value) : value;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, resolve));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveDeep(v, resolve);
    }
    return out;
  }
  return value;
}

function hasExpression(s: string): boolean {
  return s.startsWith("=") || /\{\{/.test(s);
}

// Recursive check: does this parameter value (or anything nested in it)
// contain an expression worth resolving? Used to decide whether to show
// the Rendered/Raw toggle in the parameters header.
function hasAnyExpression(value: unknown): boolean {
  if (typeof value === "string") return hasExpression(value);
  if (Array.isArray(value)) return value.some(hasAnyExpression);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(hasAnyExpression);
  }
  return false;
}

function ExpressionValue({
  value,
  resolve,
  showRaw,
}: {
  value: string;
  resolve: (template: string) => string;
  showRaw: boolean;
}) {
  const resolved = resolve(value);
  return (
    <div className="font-mono text-[12px] break-words text-[var(--text)]">
      {showRaw ? value : resolved}
    </div>
  );
}

function looksLikeHtml(s: string): boolean {
  if (s.length < 24) return false;
  const tags = s.match(/<[a-zA-Z][^>]*>/g);
  return !!tags && tags.length >= 2;
}

function HtmlValue({
  value,
  resolve,
  showRaw,
}: {
  value: string;
  resolve?: (template: string) => string;
  showRaw: boolean;
}) {
  // Section-wide raw flag controls the mode. The toggle UI for this lives
  // in the parameters section header.
  const mode: "raw" | "rendered" = showRaw ? "raw" : "rendered";
  const dark = useDarkMode();
  // n8n expression-mode strings are prefixed with `=`. Strip it, then if
  // a resolver is provided, substitute {{ ... }} expressions against the
  // current execution's runData so the preview matches reality.
  const stripped = value.startsWith("=") ? value.slice(1) : value;
  const inner = resolve ? resolve(stripped) : stripped;
  // CSS vars can't cross the iframe boundary, so we inject a small
  // baseline stylesheet that honors the current app theme. Email-specific
  // styles (table cell bgs, link colors) still win where set.
  const baseStyle = dark
    ? `body{background:#1a1a1e;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:12px;}a{color:#93c5fd;}`
    : `body{background:#ffffff;color:#2d2a26;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:12px;}`;
  // Auto-size: inject a small script that posts the body's scrollHeight
  // up to the parent on load and any time content reflows (e.g. images
  // load). Parent clamps and applies it as the iframe height.
  const sizingScript = `(function(){function post(){parent.postMessage({type:"hv-h",h:document.documentElement.scrollHeight},"*");}window.addEventListener("load",post);try{new ResizeObserver(post).observe(document.documentElement);}catch(e){}post();})();`;
  const html = `<!doctype html><html><head><base target="_blank"><style>${baseStyle}</style></head><body>${inner}<script>${sizingScript}</script></body></html>`;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number>(120);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; h?: number } | null;
      if (!data || data.type !== "hv-h" || typeof data.h !== "number") return;
      if (e.source !== iframeRef.current?.contentWindow) return;
      // Clamp: at least readable, at most a screenful so monster payloads
      // don't take over the page.
      setHeight(Math.max(60, Math.min(800, data.h)));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return (
    <div className="min-w-0">
      {mode === "rendered" ? (
        <iframe
          ref={iframeRef}
          title="HTML preview"
          srcDoc={html}
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
          className="w-full border border-[var(--border)] rounded block"
          style={{ background: dark ? "#1a1a1e" : "#ffffff", height }}
        />
      ) : (
        <pre className="m-0 font-mono text-[12px] whitespace-pre-wrap break-words bg-[var(--panel)] border border-[var(--border)] rounded px-2 py-2 max-h-[300px] overflow-auto">
          {value}
        </pre>
      )}
    </div>
  );
}

// ─── Row primitive ─────────────────────────────────────────────────────────

function Row({
  k,
  v,
  valueExtra,
}: {
  k: string;
  v: React.ReactNode;
  valueExtra?: unknown;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 px-3 py-[8px] text-[12px]">
      <div className="text-[var(--muted)] font-mono break-words">{k}</div>
      <div className="min-w-0 break-words">
        {v}
        {valueExtra != null && Object.keys(valueExtra as object).length > 0 && (
          <div className="mt-1">
            <JsonTree value={valueExtra} />
          </div>
        )}
      </div>
    </div>
  );
}

function UrlValue({
  url,
  resolve,
  showRaw,
}: {
  url: string;
  resolve?: (template: string) => string;
  showRaw: boolean;
}) {
  const isExpr = url.startsWith("=") || /\{\{|\$\{/.test(url);
  if (isExpr && resolve) {
    return <ExpressionValue value={url} resolve={resolve} showRaw={showRaw} />;
  }
  return <div className="font-mono text-[12px] break-words">{url}</div>;
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
