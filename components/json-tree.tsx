"use client";
import { useState } from "react";

// Compact, click-to-expand JSON viewer. No deps. Default-expands the top level
// so the meaningful keys are visible without interaction.

export function JsonTree({
  value,
  defaultExpanded = 1,
  maxStringLen = 80,
}: {
  value: unknown;
  defaultExpanded?: number;
  maxStringLen?: number;
}) {
  return (
    <div className="font-mono text-[12px] leading-[1.55] text-[var(--text)]">
      <Node value={value} depth={0} defaultExpanded={defaultExpanded} maxStringLen={maxStringLen} />
    </div>
  );
}

function Node({
  value,
  depth,
  defaultExpanded,
  maxStringLen,
  keyName,
}: {
  value: unknown;
  depth: number;
  defaultExpanded: number;
  maxStringLen: number;
  keyName?: string;
}) {
  if (value === null) return <Leaf k={keyName} v={<span className="text-[var(--muted)]">null</span>} />;
  if (typeof value === "boolean")
    return <Leaf k={keyName} v={<span className="text-[var(--n8n)] font-semibold">{String(value)}</span>} />;
  if (typeof value === "number")
    return <Leaf k={keyName} v={<span className="text-[#2563eb]">{value}</span>} />;
  if (typeof value === "string") return <StringLeaf k={keyName} v={value} maxLen={maxStringLen} />;
  if (Array.isArray(value))
    return (
      <Branch
        keyName={keyName}
        open={depth < defaultExpanded}
        summary={`Array(${value.length})`}
        entries={value.map((v, i) => [String(i), v])}
        depth={depth}
        defaultExpanded={defaultExpanded}
        maxStringLen={maxStringLen}
        brackets={["[", "]"]}
      />
    );
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <Branch
        keyName={keyName}
        open={depth < defaultExpanded}
        summary={`{${entries.length}}`}
        entries={entries}
        depth={depth}
        defaultExpanded={defaultExpanded}
        maxStringLen={maxStringLen}
        brackets={["{", "}"]}
      />
    );
  }
  return <Leaf k={keyName} v={String(value)} />;
}

function Leaf({ k, v }: { k?: string; v: React.ReactNode }) {
  return (
    <div className="pl-[14px]">
      {k != null && <span className="text-[var(--muted)]">{k}: </span>}
      {v}
    </div>
  );
}

function StringLeaf({ k, v, maxLen }: { k?: string; v: string; maxLen: number }) {
  const [expanded, setExpanded] = useState(false);
  const long = v.length > maxLen;
  const display = expanded || !long ? v : `${v.slice(0, maxLen)}…`;
  return (
    <div className="pl-[14px] break-words">
      {k != null && <span className="text-[var(--muted)]">{k}: </span>}
      <span className="text-[#047857]">"{display}"</span>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="ml-1 text-[10px] text-[var(--blue)] bg-transparent border-0 cursor-pointer"
        >
          {expanded ? "less" : `+${v.length - maxLen} more`}
        </button>
      )}
    </div>
  );
}

function Branch({
  keyName,
  open: defaultOpen,
  summary,
  entries,
  depth,
  defaultExpanded,
  maxStringLen,
  brackets,
}: {
  keyName?: string;
  open: boolean;
  summary: string;
  entries: Array<[string, unknown]>;
  depth: number;
  defaultExpanded: number;
  maxStringLen: number;
  brackets: [string, string];
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pl-[14px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="bg-transparent border-0 p-0 cursor-pointer text-left text-[var(--text)]"
      >
        <span className="text-[var(--muted)]">{open ? "▾" : "▸"}</span>{" "}
        {keyName != null && <span className="text-[var(--muted)]">{keyName}: </span>}
        <span className="text-[var(--muted-2)]">
          {brackets[0]} {open ? "" : summary} {open ? "" : brackets[1]}
        </span>
      </button>
      {open && (
        <div>
          {entries.map(([k, v]) => (
            <Node
              key={k}
              keyName={k}
              value={v}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
              maxStringLen={maxStringLen}
            />
          ))}
          <div className="pl-[14px] text-[var(--muted-2)]">{brackets[1]}</div>
        </div>
      )}
    </div>
  );
}
