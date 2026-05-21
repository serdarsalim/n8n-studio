"use client";
import { useEffect, useRef, useState } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  // Drag-to-move state. Offset is applied via CSS transform on the card so
  // we never touch the document layout while dragging.
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  // Track where a mousedown originated AND its position. We only close on
  // backdrop click when the gesture started on the backdrop and barely
  // moved — otherwise text-selection drags and resize-drags get misread
  // as a click on the backdrop.
  const downOnBackdropRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setOffset({ x: 0, y: 0 });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore drags that start on the close button or any focusable child.
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offset.x, baseY: offset.y };
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
  };
  const onHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        downOnBackdropRef.current = e.target === e.currentTarget;
        downPosRef.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const startedOnBackdrop = downOnBackdropRef.current;
        const startPos = downPosRef.current;
        downOnBackdropRef.current = false;
        downPosRef.current = null;
        if (e.target !== e.currentTarget) return;
        if (!startedOnBackdrop) return;
        if (startPos) {
          const dx = e.clientX - startPos.x;
          const dy = e.clientY - startPos.y;
          if (dx * dx + dy * dy > 25) return; // moved >5px → drag, not click
        }
        onClose();
      }}
    >
      <div
        className="mx-auto bg-[var(--panel)] rounded-xl shadow-[0_20px_60px_rgba(0,0,0,0.25)] overflow-hidden max-w-[calc(100vw-40px)] flex flex-col resize"
        style={{
          width: wide ? 920 : 560,
          // Wide modals get a fixed starting height so lists inside scroll
          // rather than the modal growing with content. Users can still
          // drag the bottom-right corner (CSS `resize`) to enlarge.
          height: wide ? 560 : undefined,
          minWidth: 480,
          minHeight: 320,
          maxHeight: "calc(100vh - 80px)",
          transform: `translate(${offset.x}px, ${offset.y}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-[22px] pt-[18px] pb-[14px] border-b border-[var(--border)] flex items-center justify-between cursor-move select-none touch-none"
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
        >
          <div className="text-[15px] font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-[20px] leading-none text-[var(--muted)] hover:text-[var(--text)] bg-transparent border-0 cursor-pointer p-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-[14px] flex-1 min-h-0 overflow-auto">{children}</div>
        {footer && (
          <div className="px-4 py-3 flex justify-end gap-2 flex-shrink-0">{footer}</div>
        )}
      </div>
    </div>
  );
}

export function Btn({
  children,
  primary,
  onClick,
  type,
  disabled,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  primary?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  tooltip?: string;
  className?: string;
}) {
  // Use aria-disabled (not the disabled attribute) so the native `title`
  // tooltip still shows on hover. We gate clicks ourselves.
  return (
    <button
      type={type ?? "button"}
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      title={tooltip}
      className={`text-[13px] px-[14px] py-[6px] rounded-[5px] font-medium border ${
        primary
          ? "bg-[var(--n8n)] text-white border-[var(--n8n)] hover:bg-[var(--n8n-dark)]"
          : "bg-[var(--panel)] text-[var(--text)] border-[var(--border-strong)] hover:brightness-95"
      } ${disabled ? "opacity-50 cursor-default hover:!bg-[var(--n8n)]" : "cursor-pointer"} ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
