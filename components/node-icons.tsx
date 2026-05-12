// Minimal pictograms for common n8n node types. Stroke 1.8, viewBox 24,
// monochrome — drawn to match n8n's editor silhouettes without copying
// any specific brand mark.

type IconProps = { color?: string; size?: number };
const base = (size: number) => ({
  viewBox: "0 0 24 24",
  fill: "none",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  width: size,
  height: size,
});

export function NodeIcon({
  type,
  color = "currentColor",
  size = 22,
}: {
  type: string;
  color?: string;
  size?: number;
}) {
  const t = type.toLowerCase();
  if (t.endsWith(".webhook")) return <WebhookIcon color={color} size={size} />;
  if (t.endsWith(".respondtowebhook")) return <RespondIcon color={color} size={size} />;
  if (t.includes("httprequest")) return <HttpIcon color={color} size={size} />;
  if (t.endsWith(".if")) return <IfIcon color={color} size={size} />;
  if (t.endsWith(".switch")) return <SwitchIcon color={color} size={size} />;
  if (t.endsWith(".filter")) return <FilterIcon color={color} size={size} />;
  if (t.endsWith(".code")) return <CodeIcon color={color} size={size} />;
  if (t.endsWith(".set")) return <SetIcon color={color} size={size} />;
  if (t.endsWith(".gmail")) return <GmailIcon color={color} size={size} />;
  if (t.endsWith(".hubspot")) return <HubspotIcon color={color} size={size} />;
  if (t.endsWith(".stopanderror")) return <StopErrorIcon color={color} size={size} />;
  return <GenericIcon color={color} size={size} />;
}

function WebhookIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <circle cx="9" cy="6" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M9 8.5L6.5 14.7M11.2 7.3l5.5 8.2M8.5 17h7" />
    </svg>
  );
}

function RespondIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M3 12L21 12" />
      <path d="M15 6l6 6-6 6" />
    </svg>
  );
}

function HttpIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function IfIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M12 4v6" />
      <path d="M12 10l-5 5v5" />
      <path d="M12 10l5 5v5" />
      <circle cx="12" cy="4" r="0.5" fill={color} />
    </svg>
  );
}

function SwitchIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M12 4v4" />
      <path d="M12 8l-6 4v8" />
      <path d="M12 8l6 4v8" />
      <path d="M12 8v12" />
    </svg>
  );
}

function FilterIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M3 5h18l-7 9v6l-4 2v-8L3 5z" />
    </svg>
  );
}

function CodeIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 5l-4 14" />
    </svg>
  );
}

function SetIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <path d="M4 7h16M4 12h10M4 17h13" />
      <circle cx="18" cy="12" r="1.5" fill={color} />
      <circle cx="20" cy="17" r="1.5" fill={color} />
    </svg>
  );
}

function GmailIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 7 9-7" />
    </svg>
  );
}

function HubspotIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <circle cx="17" cy="16" r="3" />
      <circle cx="6" cy="9" r="2" />
      <circle cx="17" cy="6" r="1.5" />
      <path d="M8 9l9 7M17 7.5v5.5" />
    </svg>
  );
}

function StopErrorIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  );
}

function GenericIcon({ color, size }: IconProps) {
  return (
    <svg {...base(size ?? 22)} stroke={color}>
      <rect x="5" y="5" width="14" height="14" rx="3" />
      <circle cx="12" cy="12" r="2" fill={color} />
    </svg>
  );
}
