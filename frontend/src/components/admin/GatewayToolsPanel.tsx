"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Wrench, Server } from "lucide-react";
import { resolveAgentKey, getAgentLabel, getAgentColor } from "../../lib/constants";
import { cn } from "../../lib/utils";

interface RegistryRecord {
  name: string;
  description?: string;
  recordId?: string;
  status?: string;
  descriptorType?: string;
  version?: string;
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

interface GatewayToolsPanelProps {
  token: string;
}

export function GatewayToolsPanel({ token }: GatewayToolsPanelProps) {
  const [records, setRecords] = useState<RegistryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
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
      setRecords(data.agents || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

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
        <button
          onClick={fetchRecords}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2.5">
        {error && (
          <div className="text-[13px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {loading && records.length === 0 && (
          <div className="flex items-center justify-center mt-6 gap-2 text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span className="text-[13px]">Loading...</span>
          </div>
        )}

        {!loading && !error && records.length === 0 && (
          <p className="text-[13px] text-muted-foreground text-center mt-6">
            No agents registered.
          </p>
        )}

        {records.map((record) => {
          const toolName = record.name.replace(/-/g, "_");
          const agentKey = resolveAgentKey(toolName);
          const label = getAgentLabel(agentKey);
          const colorClass = getAgentColor(agentKey);

          return (
            <div
              key={record.recordId || record.name}
              className="bg-card border border-border rounded px-2.5 py-1.5 space-y-0.5"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    `bg-${colorClass}`
                  )}
                />
                <Wrench className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                <span className="text-[13px] font-medium text-foreground font-mono truncate">
                  {record.name}
                </span>
                {record.status && (
                  <span className={cn(
                    "text-[10px] px-1.5 py-px rounded-full shrink-0 font-medium",
                    record.status === "APPROVED" ? "bg-green-500/15 text-green-500" :
                    record.status === "PENDING_APPROVAL" ? "bg-yellow-500/15 text-yellow-500" :
                    record.status === "REJECTED" ? "bg-red-500/15 text-red-500" :
                    record.status === "DEPRECATED" ? "bg-gray-500/15 text-gray-500" :
                    "bg-blue-500/15 text-blue-500"
                  )}>
                    {record.status}
                  </span>
                )}
                <span
                  className={cn(
                    "text-[10px] px-1 py-px rounded-full ml-auto shrink-0",
                    `bg-${colorClass}/15 text-${colorClass}`
                  )}
                >
                  {label}
                </span>
              </div>
              {record.description && (
                <ExpandableDescription text={record.description} />
              )}
              <div className="flex items-center gap-2 pl-4 text-[11px] text-muted-foreground">
                {record.descriptorType && (
                  <span>{record.descriptorType}</span>
                )}
                {record.version && (
                  <span>v{record.version}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
