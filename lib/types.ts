// Shape of an n8n workflow as returned by /api/v1/workflows/{id}.
// We only type the fields we use; n8n returns much more.
export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
}

export interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  parameters?: Record<string, unknown>;
  webhookId?: string;
  disabled?: boolean;
  position?: [number, number];
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Execution shape — n8n returns runData keyed by node name.
export interface N8nExecution {
  id: string;
  finished: boolean;
  mode: string;
  status?: "new" | "running" | "success" | "error" | "canceled" | "waiting";
  startedAt?: string;
  stoppedAt?: string;
  workflowId: string;
  data?: {
    resultData?: {
      runData?: Record<string, N8nNodeRun[]>;
      error?: {
        message?: string;
        description?: string;
        node?: { name?: string };
      };
      lastNodeExecuted?: string;
    };
  };
}

export interface N8nNodeRun {
  startTime?: number;
  executionTime?: number;
  source?: unknown;
  data?: {
    main?: Array<Array<{ json: unknown; [k: string]: unknown }>>;
  };
  error?: { message?: string; description?: string };
}

// Parsed view-model used by the UI.
export interface NodeCheck {
  nodeName: string;
  nodeType: string;
  // Three-state outcome. "fired" = ran successfully. "skipped" = a predecessor
  // didn't send items down this edge (branch not taken — n8n's intended
  // behavior, NOT a failure). "error" = the node was supposed to run but
  // didn't, or ran and errored.
  status: "fired" | "skipped" | "error";
  fired: boolean; // kept for backwards compatibility; equals status === "fired"
  conditions: ConditionCheck[];
  branchTaken?: "true" | "false" | number; // for IF/Switch: which output index carried items
  conditionCombinator?: "and" | "or";
  meta?: { method?: string; status?: number | string; durationMs?: number };
  error?: string;
  parameters: Record<string, unknown>;
  inputItems: unknown[];
  outputItems: unknown[];
  // Set for IF/Switch/Filter nodes. One entry per output index that
  // actually received items. Lets us render OUTPUT split by branch when
  // routing was non-uniform (e.g. 2 items TRUE, 1 item FALSE).
  outputBranches?: Array<{ index: number; label: string; items: unknown[] }>;
}

export interface ConditionCheck {
  leftLabel: string;
  rightLabel: string;
  passed: boolean;
  operator?: { type: string; operation: string; singleValue?: boolean };
}

export interface AppSettings {
  n8nUrl: string;
  apiKey: string;
}

export interface Connection {
  id: string;
  name: string;
  n8nUrl: string;
  apiKey: string;
}

export interface ConnectionsBlob {
  connections: Connection[];
  activeId: string | null;
}
