// Static fallback labels for known agents (used if dynamic generation fails)
const FALLBACK_TOOL_LABELS: Record<string, string> = {
  hr_agent: "HR",
  it_support_agent: "IT Support",
  finance_agent: "Finance",
  productivity_agent: "Productivity",
  knowledge_agent: "Knowledge",
};

// Generate human-readable label from agent name
// Examples: "it_support_agent" -> "IT Support"
//           "finance_agent" -> "Finance"
function generateAgentLabel(agentName: string): string {
  // Remove "_agent" suffix if present
  const nameWithoutSuffix = agentName.replace(/_agent$/, '');

  // Split by underscore and capitalize each word
  return nameWithoutSuffix
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Color mapping (keep static for consistent UI colors)
const AGENT_COLOR_MAP: Record<string, string> = {
  hr: "agent-hr",
  it_support: "agent-it",
  finance: "agent-finance",
  productivity: "agent-productivity",
  knowledge: "agent-knowledge",
};

// Generate color class from agent name
function generateAgentColor(agentName: string): string {
  const nameWithoutSuffix = agentName.replace(/_agent$/, '');
  return AGENT_COLOR_MAP[nameWithoutSuffix] || "primary";
}

/**
 * Normalize raw tool names from SSE events into a canonical agent key.
 * e.g. "it-support-mcp-server___it_support_agent" → "it_support_agent"
 *      "finance-mcp-server___finance_agent" → "finance_agent"
 *      "hr_agent" → "hr_agent"  (already canonical)
 */
export function resolveAgentKey(rawName: string): string {
  // Pattern: *___<agent_key> (triple underscore separator from MCP server prefix)
  const tripleSep = rawName.lastIndexOf("___");
  if (tripleSep !== -1) {
    return rawName.slice(tripleSep + 3);
  }

  // Already canonical (e.g., "finance_agent")
  return rawName;
}

/** Get a friendly display label for any raw tool name. */
export function getAgentLabel(rawName: string): string {
  const agentKey = resolveAgentKey(rawName);

  // Try fallback labels first (for known agents)
  if (FALLBACK_TOOL_LABELS[agentKey]) {
    return FALLBACK_TOOL_LABELS[agentKey];
  }

  // Generate label dynamically for new agents
  return generateAgentLabel(agentKey);
}

/** Get the color class for any raw tool name. */
export function getAgentColor(rawName: string): string {
  const agentKey = resolveAgentKey(rawName);
  return generateAgentColor(agentKey);
}
