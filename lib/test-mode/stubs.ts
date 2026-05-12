// Stub registry: maps side-effect nodes to plausible JSON shapes a Set
// node returns in their place. Iteration order matters — first match wins,
// so more-specific URL-aware patterns come BEFORE generic catch-alls.

import type { N8nNode } from "@/lib/types";

export interface Stub {
  matches(node: N8nNode): boolean;
  shape(node: N8nNode): unknown;
}

const randomId = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

export const STUBS: Stub[] = [
  // ─── HubSpot association PUT (must come BEFORE the bare notes match,
  // because the association URL contains "/notes/" too) ───────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/notes") &&
      includesUrl(n, "/associations/"),
    shape: () => ({
      id: `note-stub-${randomId()}`,
      properties: {},
      associations: {
        contacts: {
          results: [
            { id: `contact-${randomId()}`, type: "note_to_contact" },
          ],
        },
      },
    }),
  },

  // ─── HubSpot notes create/update ─────────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/notes"),
    shape: () => ({
      id: `note-stub-${randomId()}`,
      properties: {
        hs_createdate: nowIso(),
        hs_lastmodifieddate: nowIso(),
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
    }),
  },

  // ─── HubSpot contacts create/update ──────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3/objects/contacts"),
    shape: () => ({
      id: `contact-stub-${randomId()}`,
      properties: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
    }),
  },

  // ─── Generic HubSpot CRM v3 (companies, deals, tickets, etc.) ────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" &&
      isWriteMethod(n) &&
      includesUrl(n, "hubapi.com/crm/v3"),
    shape: () => ({
      id: `hubspot-stub-${randomId()}`,
      properties: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
    }),
  },

  // ─── HubSpot integration node (write operations) ─────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.hubspot" && isWriteOperation(n),
    shape: () => ({
      id: `hubspot-stub-${randomId()}`,
      properties: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }),
  },

  // ─── Gmail / email send ──────────────────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.gmail" ||
      n.type === "n8n-nodes-base.emailSend" ||
      n.type === "n8n-nodes-base.sendGrid" ||
      n.type === "n8n-nodes-base.mailgun",
    shape: () => ({
      id: `gmail-stub-${randomId()}`,
      threadId: `thread-stub-${randomId()}`,
      labelIds: ["SENT"],
    }),
  },

  // ─── Slack ───────────────────────────────────────────────────────
  {
    matches: (n) => n.type === "n8n-nodes-base.slack",
    shape: () => ({
      ok: true,
      channel: "stub-channel",
      ts: String(Date.now() / 1000),
      message: { text: "stubbed" },
    }),
  },

  // ─── Discord / Telegram / WhatsApp / Teams (generic OK) ──────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.discord" ||
      n.type === "n8n-nodes-base.telegram" ||
      n.type === "n8n-nodes-base.whatsApp" ||
      n.type === "n8n-nodes-base.whatsapp" ||
      n.type === "n8n-nodes-base.microsoftTeams",
    shape: () => ({ ok: true, id: `msg-stub-${randomId()}` }),
  },

  // ─── Salesforce / Pipedrive (CRM write) ──────────────────────────
  {
    matches: (n) =>
      (n.type === "n8n-nodes-base.salesforce" ||
        n.type === "n8n-nodes-base.pipedrive") &&
      isWriteOperation(n),
    shape: () => ({
      id: `crm-stub-${randomId()}`,
      success: true,
      createdAt: nowIso(),
    }),
  },

  // ─── Notion / Google Docs / Confluence (docs write) ──────────────
  {
    matches: (n) =>
      (n.type === "n8n-nodes-base.notion" ||
        n.type === "n8n-nodes-base.googleDocs" ||
        n.type === "n8n-nodes-base.confluence") &&
      isWriteOperation(n),
    shape: () => ({
      id: `doc-stub-${randomId()}`,
      url: "https://stub.example/doc",
      createdAt: nowIso(),
    }),
  },

  // ─── Airtable / Google Sheets (row write) ────────────────────────
  {
    matches: (n) =>
      (n.type === "n8n-nodes-base.airtable" ||
        n.type === "n8n-nodes-base.googleSheets") &&
      isWriteOperation(n),
    shape: () => ({
      id: `row-stub-${randomId()}`,
      fields: {},
      createdTime: nowIso(),
    }),
  },

  // ─── Stripe / PayPal (payment write) ─────────────────────────────
  {
    matches: (n) =>
      (n.type === "n8n-nodes-base.stripe" ||
        n.type === "n8n-nodes-base.payPal") &&
      isWriteOperation(n),
    shape: () => ({
      id: `pay-stub-${randomId()}`,
      object: "stub",
      created: Math.floor(Date.now() / 1000),
      status: "succeeded",
    }),
  },

  // ─── Storage writes (S3 / Drive / Dropbox) ───────────────────────
  {
    matches: (n) =>
      (n.type === "n8n-nodes-base.s3" ||
        n.type === "n8n-nodes-base.awsS3" ||
        n.type === "n8n-nodes-base.googleDrive" ||
        n.type === "n8n-nodes-base.dropbox") &&
      isWriteOperation(n),
    shape: () => ({
      id: `file-stub-${randomId()}`,
      name: "stub.bin",
      url: "https://stub.example/file",
      createdAt: nowIso(),
    }),
  },

  // ─── File system writes ──────────────────────────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.writeBinaryFile" ||
      n.type === "n8n-nodes-base.readWriteFile",
    shape: (n) => ({
      stub: true,
      operation: "write",
      fileName: stringify(n.parameters?.fileName ?? "stub.bin"),
    }),
  },

  // ─── Generic HTTP write (final HTTP catch) ───────────────────────
  {
    matches: (n) =>
      n.type === "n8n-nodes-base.httpRequest" && isWriteMethod(n),
    shape: (n) => ({
      stub: true,
      method: stringify(n.parameters?.method ?? "POST"),
      url: stringify(n.parameters?.url ?? ""),
      statusCode: 200,
    }),
  },

  // ─── Generic fallback ────────────────────────────────────────────
  {
    matches: () => true,
    shape: (n) => ({
      stub: true,
      replaced_node: n.name,
      original_type: n.type,
    }),
  },
];

export function pickStubShape(node: N8nNode): unknown {
  for (const s of STUBS) {
    if (s.matches(node)) return s.shape(node);
  }
  return { stub: true, replaced_node: node.name, original_type: node.type };
}

// ─── helpers ─────────────────────────────────────────────────────────

export function isWriteMethod(n: N8nNode): boolean {
  const m = String(
    n.parameters?.method ?? n.parameters?.requestMethod ?? "GET",
  ).toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}

function includesUrl(n: N8nNode, needle: string): boolean {
  const url = String(n.parameters?.url ?? "");
  return url.includes(needle);
}

export function isWriteOperation(n: N8nNode): boolean {
  const op = String(n.parameters?.operation ?? "").toLowerCase();
  return /^(create|update|upsert|delete|insert|append|add|remove|send|post|write)/.test(
    op,
  );
}

function stringify(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
