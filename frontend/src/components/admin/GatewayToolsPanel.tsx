"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Wrench, Server } from "lucide-react";
import { resolveAgentKey, getAgentLabel, getAgentColor } from "../../lib/constants";
import { cn } from "../../lib/utils";

interface GatewayTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > 80;

  return (
    <p className="text-[12px] text-muted-foreground leading-snug pl-4">
      {needsTruncation && !expanded ? text.slice(0, 80) + "..." : text}
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-1 text-accent hover:text-accent/80 font-medium"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </p>
  );
}

/** Map agent key (e.g. "admin_agent") to Gateway target name (e.g. "admin-mcp-server") */
function agentKeyToTargetName(agentKey: string): string {
  const base = agentKey.replace(/_agent$/, "").replace(/_/g, "-");
  return `${base}-mcp-server`;
}

interface GatewayToolsPanelProps {
  token: string;
}

export function GatewayToolsPanel({ token }: GatewayToolsPanelProps) {
  const [tools, setTools] = useState<GatewayTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncingAgents, setSyncingAgents] = useState<Set<string>>(new Set());
  const [syncingAll, setSyncingAll] = useState(false);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gateway/tools", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setTools(data.tools || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleSync = useCallback(async (agentKey: string) => {
    const targetName = agentKeyToTargetName(agentKey);
    setSyncingAgents((prev) => new Set(prev).add(agentKey));
    try {
      const res = await fetch("/api/gateway/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("Sync failed:", body);
      }
      // Wait for sync to complete, then refresh tool list
      await new Promise((r) => setTimeout(r, 3000));
      await fetchTools();
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncingAgents((prev) => {
        const next = new Set(prev);
        next.delete(agentKey);
        return next;
      });
    }
  }, [fetchTools]);

  const handleSyncAll = useCallback(async () => {
    setSyncingAll(true);
    try {
      const res = await fetch("/api/gateway/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.error("Sync all failed");
      }
      await new Promise((r) => setTimeout(r, 5000));
      await fetchTools();
    } catch (err) {
      console.error("Sync all error:", err);
    } finally {
      setSyncingAll(false);
    }
  }, [fetchTools]);

  // Filter out internal gateway tools and group by agent
  const agentTools = tools.filter(
    (t) => !t.name.toLowerCase().includes("x_amz_bedrock_agentcore")
  );
  const grouped = agentTools.reduce<Record<string, GatewayTool[]>>((acc, tool) => {
    const agentKey = resolveAgentKey(tool.name);
    if (!acc[agentKey]) acc[agentKey] = [];
    acc[agentKey].push(tool);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col">
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Server className="w-3 h-3 text-muted-foreground" />
          <h3 className="font-display font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
            Agent Registry
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSyncAll}
            disabled={syncingAll}
            className="text-[11px] text-muted-foreground hover:text-accent transition-colors disabled:opacity-30"
            title="Sync all targets"
          >
            Sync All
          </button>
          <button
            onClick={fetchTools}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
            title="Refresh"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2.5">
        {error && (
          <div className="text-[13px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {loading && agentTools.length === 0 && (
          <div className="flex items-center justify-center mt-6 gap-2 text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="text-[13px]">Loading...</span>
          </div>
        )}

        {!loading && !error && agentTools.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center mt-6">
            No agents registered.
          </p>
        )}

        {Object.entries(grouped).map(([agentKey, agentTools]) => {
          const label = getAgentLabel(agentKey);
          const colorClass = getAgentColor(agentKey);
          const isSyncing = syncingAll || syncingAgents.has(agentKey);

          return (
            <div key={agentKey} className="space-y-1">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    `bg-${colorClass}`
                  )}
                />
                <h3 className={cn("text-[13px] font-semibold font-display uppercase tracking-wider", `text-${colorClass}`)}>
                  {label}
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  {agentTools.length} tool{agentTools.length > 1 ? "s" : ""}
                </span>
                <button
                  onClick={() => handleSync(agentKey)}
                  disabled={isSyncing}
                  className="ml-auto text-muted-foreground hover:text-accent transition-colors disabled:opacity-40"
                  title={`Sync ${label} target`}
                >
                  <RefreshCw className={cn("w-2.5 h-2.5", isSyncing && "animate-spin")} />
                </button>
              </div>

              {agentTools.map((tool) => (
                <div
                  key={tool.name}
                  className="bg-card border border-border rounded px-2.5 py-1.5 space-y-0.5"
                >
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                    <span className="text-[13px] font-medium text-foreground font-mono truncate">
                      {tool.name.includes("___")
                        ? tool.name.split("___").pop()
                        : tool.name}
                    </span>
                  </div>
                  {tool.description && (
                    <ExpandableDescription text={tool.description} />
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
