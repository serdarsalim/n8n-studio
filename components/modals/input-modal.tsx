"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createFixture,
  deleteFixture,
  type Fixture,
  readFixtures,
  updateFixture,
} from "@/lib/client";
import { Modal } from "./modal";

export function InputModal({
  open,
  onClose,
  workflowId,
  initialText,
  selectedFixtureId,
  onChange,
  onSelectFixture,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string | null;
  initialText: string;
  selectedFixtureId: string | null;
  onChange: (text: string, parsed: unknown) => void;
  onSelectFixture: (id: string | null) => void;
}) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);

  // Hydrate on open. We re-read fixtures every time to catch any auto-
  // saves that happened while the modal was closed (e.g. loading a past
  // execution from the canvas).
  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setError(null);
    if (workflowId) setFixtures(readFixtures(workflowId));
    else setFixtures([]);
  }, [open, initialText, workflowId]);

  const selectedFixture = useMemo(
    () => fixtures.find((f) => f.id === selectedFixtureId) ?? null,
    [fixtures, selectedFixtureId],
  );
  const isDirty = selectedFixture ? selectedFixture.text !== text : false;

  function refreshFixtures() {
    if (!workflowId) return;
    setFixtures(readFixtures(workflowId));
  }

  function handleTextChange(next: string) {
    setText(next);
    try {
      const parsed = next.trim() ? JSON.parse(next) : {};
      setError(null);
      onChange(next, parsed);
    } catch (e) {
      setError(`Invalid JSON: ${(e as Error).message}`);
    }
  }

  function handleSelect(id: string) {
    const f = fixtures.find((x) => x.id === id);
    if (!f) return;
    setText(f.text);
    setError(null);
    onSelectFixture(id);
    onChange(f.text, f.json);
  }

  function handleNew() {
    if (!workflowId) return;
    const name = uniqueName("New fixture", fixtures);
    let parsed: unknown = {};
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
      // can't parse the current editor — start fresh with {}
      parsed = {};
    }
    const fixture = createFixture(workflowId, name, text, parsed);
    setFixtures([...fixtures, fixture]);
    onSelectFixture(fixture.id);
  }

  function handleUpdate() {
    if (!workflowId || !selectedFixture || error) return;
    let parsed: unknown;
    try {
      parsed = text.trim() ? JSON.parse(text) : {};
    } catch {
      return;
    }
    updateFixture(workflowId, selectedFixture.id, { text, json: parsed });
    refreshFixtures();
  }

  function handleRename(id: string, name: string) {
    if (!workflowId) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    updateFixture(workflowId, id, { name: trimmed });
    refreshFixtures();
  }

  function handleDelete(id: string) {
    if (!workflowId) return;
    deleteFixture(workflowId, id);
    if (selectedFixtureId === id) onSelectFixture(null);
    refreshFixtures();
  }

  return (
    <Modal open={open} onClose={onClose} title="Input" wide>
      <div className="flex gap-3 h-full min-h-[360px]">
        <aside className="w-[300px] flex-shrink-0 flex flex-col border border-[var(--border)] rounded-md bg-[var(--panel-soft)] overflow-hidden">
          <button
            type="button"
            onClick={handleNew}
            disabled={!workflowId}
            className="text-left text-[12px] text-[var(--blue)] hover:text-[var(--text)] px-3 py-2 border-b border-[var(--border)] bg-transparent border-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            + New fixture
          </button>
          <div className="overflow-y-auto flex-1">
            {fixtures.length === 0 && (
              <div className="text-[11px] text-[var(--muted-2)] px-3 py-3 italic">
                No saved fixtures yet. Paste JSON on the right and hit + New.
              </div>
            )}
            {fixtures.map((f) => (
              <FixtureRow
                key={f.id}
                fixture={f}
                selected={f.id === selectedFixtureId}
                dirty={f.id === selectedFixtureId && isDirty}
                onSelect={() => handleSelect(f.id)}
                onRename={(name) => handleRename(f.id, name)}
                onDelete={() => handleDelete(f.id)}
              />
            ))}
          </div>
          {selectedFixture && isDirty && !error && (
            <button
              type="button"
              onClick={handleUpdate}
              className="text-left text-[12px] text-[var(--blue)] hover:text-[var(--text)] px-3 py-2 border-t border-[var(--border)] bg-transparent border-0 cursor-pointer"
            >
              ↑ Update “{selectedFixture.name}”
            </button>
          )}
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder='{ "contactId": "abc", "qualified": true }'
            className="w-full flex-1 min-h-[200px] px-3 py-2 text-[12px] font-mono rounded-[5px] border border-[var(--border-strong)] bg-[var(--panel-soft)] text-[var(--text)] outline-none focus:border-[var(--n8n)] resize-none"
          />
          {error ? (
            <div className="text-[12px] text-[var(--red-text)] mt-2 font-mono">
              {error} · last valid version still applied
            </div>
          ) : (
            <div className="text-[11px] text-[var(--muted-2)] mt-2">
              {selectedFixture
                ? isDirty
                  ? `Editing “${selectedFixture.name}” (unsaved changes — applied live)`
                  : `Loaded: ${selectedFixture.name}`
                : "Current input (not saved as a fixture)"}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FixtureRow({
  fixture,
  selected,
  dirty,
  onSelect,
  onRename,
  onDelete,
}: {
  fixture: Fixture;
  selected: boolean;
  dirty: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fixture.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(fixture.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, fixture.name]);

  function commit() {
    setEditing(false);
    if (draft.trim() && draft.trim() !== fixture.name) onRename(draft.trim());
  }

  return (
    <div
      className={`group flex items-center gap-[6px] px-2 py-[6px] text-[12px] cursor-pointer ${
        selected
          ? "bg-[var(--selected-bg)] border-l-2 border-[var(--selected-border)]"
          : "hover:bg-[var(--panel-soft-2)] border-l-2 border-transparent"
      }`}
      onClick={() => {
        if (!editing) onSelect();
      }}
    >
      <span
        className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${
          selected ? "bg-[var(--selected-border)]" : "bg-transparent border border-[var(--muted-2)]"
        }`}
      />
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(fixture.name);
              setEditing(false);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-[var(--panel)] border border-[var(--border-strong)] rounded px-[4px] py-0 text-[12px] font-medium outline-none focus:border-[var(--n8n)]"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            if (selected) {
              // Second click on a selected row enters rename mode.
              e.stopPropagation();
              setEditing(true);
            }
          }}
          className="flex-1 min-w-0 text-left truncate bg-transparent border-0 p-0 cursor-pointer font-medium text-[var(--text)]"
          title={fixture.name}
        >
          {fixture.name}
          {dirty && <span className="ml-1 text-[var(--muted)] italic">(dirty)</span>}
        </button>
      )}
      {fixture.source === "execution" && (
        <span
          className="text-[9px] uppercase tracking-[0.3px] text-[var(--muted-2)] flex-shrink-0"
          title="Sourced from a past execution"
        >
          exec
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete fixture “${fixture.name}”?`)) onDelete();
        }}
        title="Delete fixture"
        aria-label="Delete fixture"
        className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--red)] bg-transparent border-0 p-0 cursor-pointer text-[14px] leading-none w-[14px] h-[14px] flex items-center justify-center"
      >
        ×
      </button>
    </div>
  );
}

function uniqueName(base: string, fixtures: Fixture[]): string {
  const names = new Set(fixtures.map((f) => f.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}
