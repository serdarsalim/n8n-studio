"use client";
import { useEffect, useMemo, useState } from "react";
import { topoOrder } from "@/lib/execution";
import type { N8nWorkflow, NodeCheck } from "@/lib/types";
import { NodeIcon } from "./node-icons";

const NODE_W = 36;
const NODE_H = 36;
const ICON_SIZE = 18;
const LABEL_W = 110; // label sits to the RIGHT of each node
const LABEL_H = 28;
const PAD = 14;
// Workflow x is the flow direction (left→right in n8n editor). We rotate
// 90° clockwise so x→screen.y (flow goes top-to-bottom). Tight vertical
// spacing since this is a navigation aid, not a duplicate canvas.
const FLOW_SCALE = 0.03;
const BRANCH_SCALE = 0.42;
// Max parallel branches shown side-by-side. Wider workflows snap into
// these lanes, losing some n8n y-precision but staying readable.
const MAX_COLS = 3;
const COL_WIDTH = NODE_W + LABEL_W + 4;

export function WorkflowGraph({
  workflow,
  checks,
  selectedName,
  onSelect,
  maxHeight,
}: {
  workflow: N8nWorkflow;
  checks: NodeCheck[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  maxHeight?: number;
}) {
  // Track viewport height so the graph can compress vertically to fit
  // without needing an inner scrollbar.
  const [viewportH, setViewportH] = useState<number>(() =>
    typeof window === "undefined" ? 800 : window.innerHeight,
  );
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const fitHeight = maxHeight ?? viewportH - 120;
  const layout = useMemo(() => buildLayout(workflow, fitHeight), [workflow, fitHeight]);
  const checksByName = useMemo(
    () => new Map(checks.map((c) => [c.nodeName, c])),
    [checks],
  );

  if (!layout) return null;
  const { positions, edges, width, height } = layout;

  // Spread the endpoint X across the node width so multiple edges that
  // leave (or arrive at) the same node don't collapse onto one line.
  // For each source node we slot its outgoing edges evenly across the
  // node bottom; same on the target node's top for incoming edges.
  const edgePortSlots = computeEdgePortSlots(edges);

  return (
    <svg
      // Render at intrinsic aspect ratio but let the container drive the
      // actual rendered width — when the pane is resized, the SVG scales
      // via viewBox instead of clipping or scrolling.
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMin meet"
      className="block select-none w-full h-auto"
    >
      {/* Edges first so they sit under nodes. Endpoints are spread across
          the source/target node widths so multiple edges fanning out from
          (or into) the same node don't overlap into a single thick line. */}
      {edges.map((e, i) => {
        const from = positions.get(e.fromName);
        const to = positions.get(e.toName);
        if (!from || !to) return null;
        const srcSlot = edgePortSlots.source.get(`${e.fromName}#${i}`) ?? 0.5;
        const dstSlot = edgePortSlots.target.get(`${e.toName}#${i}`) ?? 0.5;
        const x1 = from.x + NODE_W * srcSlot;
        const y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W * dstSlot;
        const y2 = to.y;
        // Cubic bezier with vertical control offsets — smooth S-curve when
        // source and target are horizontally offset.
        const cpdy = Math.max(20, (y2 - y1) / 2);
        const d = `M ${x1} ${y1} C ${x1} ${y1 + cpdy}, ${x2} ${y2 - cpdy}, ${x2} ${y2}`;
        const target = checksByName.get(e.toName);
        const stroke =
          target?.status === "fired"
            ? "var(--green)"
            : target?.status === "error"
              ? "var(--red)"
              : "var(--muted-2)";
        const dash = target && target.status !== "fired" ? "4 4" : undefined;
        return (
          <path
            key={i}
            d={d}
            stroke={stroke}
            strokeWidth={1.6}
            fill="none"
            strokeDasharray={dash}
            opacity={target?.status === "skipped" ? 0.5 : 1}
          />
        );
      })}

      {/* Nodes */}
      {[...positions.entries()].map(([name, pos]) => {
        const node = workflow.nodes.find((n) => n.name === name);
        if (!node) return null;
        const check = checksByName.get(name);
        const isSelected = selectedName === name;
        const ring = isSelected
          ? "var(--selected-border)"
          : check?.status === "fired"
            ? "var(--green)"
            : check?.status === "error"
              ? "var(--red)"
              : "var(--border-strong)";
        const ringWidth = isSelected
          ? 2.5
          : check?.status === "fired" || check?.status === "error"
            ? 1.8
            : 1.2;
        const fill = isSelected ? "var(--selected-bg)" : "var(--panel)";
        const dim = check?.status === "skipped";
        return (
          <g
            key={name}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => onSelect(name)}
            style={{ cursor: "pointer" }}
            opacity={dim ? 0.55 : 1}
          >
            <rect
              x={0}
              y={0}
              width={NODE_W}
              height={NODE_H}
              rx={9}
              fill={fill}
              stroke={ring}
              strokeWidth={ringWidth}
              style={isSelected ? { filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.2))" } : undefined}
            />
            <g
              transform={`translate(${(NODE_W - ICON_SIZE) / 2}, ${(NODE_H - ICON_SIZE) / 2})`}
              style={{ color: "var(--text)" }}
            >
              <NodeIcon type={node.type} size={ICON_SIZE} />
            </g>
            {/* Status dot, top-right */}
            {check && check.status !== "fired" && (
              <g transform={`translate(${NODE_W - 6}, 6)`}>
                <circle
                  r={5.5}
                  fill={check.status === "error" ? "var(--red)" : "var(--muted-2)"}
                  stroke="var(--panel)"
                  strokeWidth={1.2}
                />
                <text
                  x={0}
                  y={2.5}
                  textAnchor="middle"
                  fontSize={8}
                  fontWeight={700}
                  fill="white"
                >
                  {check.status === "error" ? "✕" : "–"}
                </text>
              </g>
            )}
            {/* Label to the right */}
            <foreignObject
              x={NODE_W + 6}
              y={(NODE_H - LABEL_H) / 2}
              width={LABEL_W}
              height={LABEL_H}
            >
              <div
                className={`text-[10px] leading-[1.15] px-[2px] py-[2px] ${isSelected ? "text-[var(--text)] font-semibold" : "text-[var(--muted)]"}`}
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  wordBreak: "break-word",
                }}
                title={name}
              >
                {name}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}

interface Layout {
  positions: Map<string, { x: number; y: number }>;
  edges: Array<{ fromName: string; toName: string; outputIndex: number }>;
  width: number;
  height: number;
}

function buildLayout(workflow: N8nWorkflow, fitHeight: number): Layout | null {
  const nodes = workflow.nodes.filter(
    (n) =>
      !n.disabled &&
      !n.type.endsWith(".stickyNote") &&
      !n.type.endsWith(".StickyNote") &&
      Array.isArray(n.position),
  );
  if (nodes.length === 0) return null;

  const xs = nodes.map((n) => n.position![0]);
  const ys = nodes.map((n) => n.position![1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  // Bucket unique workflow.y values into MAX_COLS lanes. For workflows
  // narrow enough to fit naturally (≤ MAX_COLS unique y values, or where
  // BRANCH_SCALE keeps labels from overlapping) we use proportional
  // positions; otherwise we snap to columns to cap the width.
  const uniqueYs = [...new Set(nodes.map((n) => n.position![1]))].sort((a, b) => a - b);

  let minParallelGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.abs(nodes[i].position![0] - nodes[j].position![0]) < 1) {
        const gap = Math.abs(nodes[i].position![1] - nodes[j].position![1]);
        if (gap > 0 && gap < minParallelGap) minParallelGap = gap;
      }
    }
  }
  const requiredScale =
    minParallelGap === Infinity ? 0 : (NODE_W + LABEL_W + 12) / minParallelGap;
  const branchScale = Math.max(BRANCH_SCALE, requiredScale);

  const proportionalWidth = (maxY - minY) * branchScale;
  const useColumns =
    uniqueYs.length > MAX_COLS || proportionalWidth > MAX_COLS * COL_WIDTH;

  const yToCol = new Map<number, number>();
  uniqueYs.forEach((y, i) => {
    const col =
      uniqueYs.length <= MAX_COLS
        ? i
        : Math.min(MAX_COLS - 1, Math.floor((i / uniqueYs.length) * MAX_COLS));
    yToCol.set(y, col);
  });

  // Always render at the same tight FLOW_SCALE so every desktop size
  // looks identical. Tall workflows scroll with the page rather than
  // getting squished to fit viewport height.
  const flowScale = FLOW_SCALE;

  // Detect screen-position collisions (same column AND nearly same row);
  // nudge collisions down so they're at least distinguishable. Iterate in
  // topological order so earlier-in-the-DAG nodes claim their slots first.
  const positions = new Map<string, { x: number; y: number }>();
  const occupied: Array<{ x: number; y: number }> = [];
  const orderedNodes = topoOrder(nodes, workflow);
  for (const n of orderedNodes) {
    let sx: number;
    if (useColumns) {
      const col = yToCol.get(n.position![1]) ?? 0;
      sx = PAD + col * COL_WIDTH;
    } else {
      sx = (n.position![1] - minY) * branchScale + PAD;
    }
    let sy = (n.position![0] - minX) * flowScale + PAD;
    while (
      occupied.some((p) => Math.abs(p.x - sx) < 4 && Math.abs(p.y - sy) < NODE_H + 8)
    ) {
      sy += NODE_H + 12;
    }
    occupied.push({ x: sx, y: sy });
    positions.set(n.name, { x: sx, y: sy });
  }

  const conns = workflow.connections as Record<
    string,
    { main?: Array<Array<{ node: string; type: string; index: number }>> } | undefined
  >;
  const edges: Layout["edges"] = [];
  for (const [fromName, entry] of Object.entries(conns ?? {})) {
    const branches = entry?.main ?? [];
    branches.forEach((targets, outputIndex) => {
      for (const t of targets ?? []) {
        if (!positions.has(t.node)) continue;
        edges.push({ fromName, toName: t.node, outputIndex });
      }
    });
  }

  // Width and height derive from actual placed positions so collision nudges
  // are accounted for.
  let maxSX = 0;
  let maxSY = 0;
  for (const p of positions.values()) {
    if (p.x > maxSX) maxSX = p.x;
    if (p.y > maxSY) maxSY = p.y;
  }
  const width = maxSX + NODE_W + LABEL_W + 6 + PAD;
  const height = maxSY + NODE_H + PAD;
  return { positions, edges, width, height };
}

// For each node, slot its outgoing edges along the bottom edge (and
// incoming edges along the top edge) so parallel lines don't overlap.
// Returns fractional positions in [0, 1] keyed by `${nodeName}#${edgeIndex}`.
function computeEdgePortSlots(
  edges: Array<{ fromName: string; toName: string; outputIndex: number }>,
): { source: Map<string, number>; target: Map<string, number> } {
  const source = new Map<string, number>();
  const target = new Map<string, number>();
  // Group by source: preserve original edge order to keep colors stable.
  const outByNode = new Map<string, number[]>();
  const inByNode = new Map<string, number[]>();
  edges.forEach((e, idx) => {
    const o = outByNode.get(e.fromName) ?? [];
    o.push(idx);
    outByNode.set(e.fromName, o);
    const i = inByNode.get(e.toName) ?? [];
    i.push(idx);
    inByNode.set(e.toName, i);
  });
  for (const [, idxs] of outByNode) {
    // Spread across the middle 70% of the node width so endpoints stay
    // visually inside the icon.
    const n = idxs.length;
    idxs.forEach((idx, i) => {
      const slot = n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1);
      source.set(`${edges[idx].fromName}#${idx}`, slot);
    });
  }
  for (const [, idxs] of inByNode) {
    const n = idxs.length;
    idxs.forEach((idx, i) => {
      const slot = n === 1 ? 0.5 : 0.15 + (0.7 * i) / (n - 1);
      target.set(`${edges[idx].toName}#${idx}`, slot);
    });
  }
  return { source, target };
}
