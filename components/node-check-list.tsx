"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NodeCheck } from "@/lib/types";
import { NodeDetail } from "./node-detail";

export function NodeCheckList({
  checks,
  preRun,
  emptyHint,
  selectedName,
  onSelect,
  buildResolver,
  buildRawResolver,
}: {
  checks: NodeCheck[];
  preRun?: boolean;
  emptyHint?: string;
  selectedName?: string | null;
  onSelect?: (name: string) => void;
  buildResolver?: (nodeName: string) => (template: string) => string;
  buildRawResolver?: (nodeName: string) => (template: string) => unknown;
}) {
  // Accordion-with-pins. Exactly one card is "the active expansion" at a
  // time (clicking another collapses the previous one), but pinned cards
  // survive the collapse and stay open.
  const [activeName, setActiveName] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  // External selection (from the graph) opens that row as the active one.
  useEffect(() => {
    if (selectedName) setActiveName(selectedName);
  }, [selectedName]);

  const toggleRow = useCallback(
    (name: string) => {
      setActiveName((prev) => (prev === name ? null : name));
      onSelect?.(name);
    },
    [onSelect],
  );

  const togglePin = useCallback((name: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  if (checks.length === 0) {
    return (
      <div className="text-[13px] text-[var(--muted)] text-center py-12">
        {emptyHint ?? "Run a workflow to see per-node results."}
      </div>
    );
  }
  return (
    <div>
      {checks.map((c) => (
        <NodeCheckRow
          key={c.nodeName}
          check={c}
          preRun={preRun}
          open={activeName === c.nodeName || pinned.has(c.nodeName)}
          pinned={pinned.has(c.nodeName)}
          selected={c.nodeName === selectedName}
          onToggle={() => toggleRow(c.nodeName)}
          onTogglePin={() => togglePin(c.nodeName)}
          resolve={buildResolver?.(c.nodeName)}
          resolveRaw={buildRawResolver?.(c.nodeName)}
        />
      ))}
    </div>
  );
}

function NodeCheckRow({
  check,
  preRun,
  open,
  pinned,
  selected,
  onToggle,
  onTogglePin,
  resolve,
  resolveRaw,
}: {
  check: NodeCheck;
  preRun?: boolean;
  open: boolean;
  pinned: boolean;
  selected?: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  resolve?: (template: string) => string;
  resolveRaw?: (template: string) => unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Allow expanding any post-run row, not just fired ones. Skipped /
  // errored nodes still have parameters worth inspecting, and showing
  // the empty INPUT/OUTPUT panes makes it obvious nothing flowed through.
  const hasDetail = !preRun;

  // When this row becomes the selected one (e.g. clicked from the graph),
  // scroll it into view if offscreen. Expansion is driven by parent state.
  useEffect(() => {
    if (!selected) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
    if (!inView) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selected]);

  const marker = preRun
    ? { glyph: "·", color: "text-[var(--muted-2)]" }
    : check.status === "fired"
      ? { glyph: "✓", color: "text-[var(--green)]" }
      : check.status === "error"
        ? { glyph: "✗", color: "text-[var(--red)]" }
        : { glyph: "–", color: "text-[var(--muted-2)]" };
  const subtle = !preRun && check.status === "skipped";
  const showPin = hasDetail && (pinned || open);
  return (
    <div
      ref={ref}
      className={`group mb-[6px] rounded-md overflow-hidden border ${
        selected
          ? "border-[var(--selected-border)] border-2 bg-[var(--selected-bg)] shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
          : "border-[var(--border)] bg-[var(--panel)]"
      } ${subtle ? "opacity-60" : ""}`}
    >
      <div
        role={hasDetail ? "button" : undefined}
        tabIndex={hasDetail ? 0 : undefined}
        onClick={() => {
          if (hasDetail) onToggle();
        }}
        onKeyDown={(e) => {
          if (!hasDetail) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        title={check.status === "skipped" ? "Branch not taken" : undefined}
        className={`w-full flex items-center gap-[10px] px-[14px] py-[7px] text-[14px] text-left ${
          open ? "bg-[var(--panel-soft)]" : ""
        } ${hasDetail ? "cursor-pointer hover:bg-[var(--panel-soft)]" : "cursor-default"}`}
      >
        <PinButton
          visible={hasDetail}
          pinned={pinned}
          alwaysShow={showPin}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
        />
        <span className="flex-1 font-medium truncate">{check.nodeName}</span>
        {check.status === "skipped" && !preRun ? (
          <span className="text-[11px] text-[var(--muted)] italic mr-2 whitespace-nowrap">
            branch not taken
          </span>
        ) : (
          <span className="text-[11px] text-[var(--muted)] font-mono mr-2 truncate max-w-[140px]">
            {shortType(check.nodeType)}
          </span>
        )}
        <span className={`w-[14px] text-center font-bold ${marker.color}`}>{marker.glyph}</span>
      </div>
      {open && hasDetail && (
        <div className="border-t border-[var(--border)]">
          <NodeDetail check={check} resolve={resolve} resolveRaw={resolveRaw} />
        </div>
      )}
    </div>
  );
}

// "n8n-nodes-base.httpRequest" -> "httpRequest"
function shortType(t: string): string {
  const dot = t.lastIndexOf(".");
  return dot === -1 ? t : t.slice(dot + 1);
}

function PinButton({
  visible,
  pinned,
  alwaysShow,
  onClick,
}: {
  visible: boolean;
  pinned: boolean;
  alwaysShow: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (!visible) return <span className="inline-block w-[18px]" />;
  return (
    <button
      type="button"
      onClick={onClick}
      title={pinned ? "Unpin (allow auto-collapse)" : "Pin to keep open when other rows expand"}
      aria-label={pinned ? "Unpin row" : "Pin row open"}
      className={`w-[18px] h-[18px] flex items-center justify-center bg-transparent border-0 p-0 cursor-pointer transition-opacity ${
        alwaysShow ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
      } ${pinned ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
    >
      <PinIcon filled={pinned} />
    </button>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  // Pushpin viewed from the front. Filled when pinned.
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-[14px] h-[14px]"
    >
      <path d="M12 17v5" />
      <path d="M9 4h6v4l3 5H6l3-5V4z" />
    </svg>
  );
}
