"use client";

import { useState, useEffect, useCallback } from "react";
import { Terminal, RefreshCw, Trash2, Clock, CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";
import { getAgentColor } from "../../lib/constants";
import { cn } from "../../lib/utils";

interface ToolCallLog {
  id: string;
  timestamp: number;
  user: string;
  sessionId: string;
  toolName: string;
  agentName: string;
  input: any;
  output?: any;
  status: "pending" | "completed" | "error";
  error?: string;
  duration?: number;
}

interface ToolCallPanelProps {
  username: string | null;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case "error":
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    case "pending":
      return <Clock className="w-3.5 h-3.5 text-amber-500 animate-pulse" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function ToolCallCard({ log }: { log: ToolCallLog }) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = getAgentColor(log.toolName);

  const formatTimestamp = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        <StatusIcon status={log.status} />
        <span className={cn("text-xs font-semibold", colorClass)}>
          {log.agentName}
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto">
          {formatTimestamp(log.timestamp)}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {formatDuration(log.duration)}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {/* Tool name */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">
              Tool
            </div>
            <div className="text-xs text-foreground font-mono bg-muted rounded px-2 py-1">
              {log.toolName}
            </div>
          </div>

          {/* Input */}
          <div>
            <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">
              Input
            </div>
            <pre className="text-[11px] text-foreground font-mono bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
              {JSON.stringify(log.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {log.output !== undefined && (
            <div>
              <div className="text-[10px] text-muted-foreground uppercase font-semibold mb-0.5">
                Output
              </div>
              <pre className="text-[11px] text-foreground font-mono bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                {typeof log.output === "string"
                  ? log.output
                  : JSON.stringify(log.output, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {log.error && (
            <div>
              <div className="text-[10px] text-red-500 uppercase font-semibold mb-0.5">
                Error
              </div>
              <div className="text-xs text-red-500 bg-red-50 rounded px-2 py-1.5">
                {log.error}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border">
            <span>Session: {log.sessionId.slice(-8)}</span>
            <span>•</span>
            <span>ID: {log.id.slice(0, 8)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ToolCallPanel({ username }: ToolCallPanelProps) {
  const [logs, setLogs] = useState<ToolCallLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!username) {
      setLogs([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/toolcalls?user=${username}&limit=50`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setLogs(data.toolCalls || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [username]);

  const handleClear = useCallback(async () => {
    if (!username) return;

    try {
      const res = await fetch(`/api/toolcalls?user=${username}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      setLogs([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [username]);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Not logged in
  if (!username) {
    return (
      <div className="h-full overflow-y-auto flex flex-col items-center justify-center text-center p-6 gap-4">
        <Terminal className="w-10 h-10 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1">Tool Calls</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Log in to see tool call history.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Terminal className="w-4 h-4 text-primary shrink-0" />
        <span className="font-display font-semibold text-sm text-foreground">
          Tool Calls
        </span>
        {logs.length > 0 && (
          <span className="text-[11px] bg-primary/10 text-primary font-semibold rounded-full px-2 py-0.5">
            {logs.length}
          </span>
        )}
        <div className="flex-1" />
        {logs.length > 0 && (
          <button
            onClick={handleClear}
            className="text-muted-foreground hover:text-red-600 transition-colors"
            title="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Error */}
        {error && (
          <div className="mx-3 mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* No logs */}
        {!loading && logs.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
            <Terminal className="w-8 h-8 text-muted-foreground" />
            <div>
              <p className="text-xs font-medium text-foreground">No tool calls yet</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Tool calls will appear here as they happen
              </p>
            </div>
          </div>
        )}

        {/* Tool call cards */}
        {logs.length > 0 && (
          <div className="p-3 space-y-2">
            {logs.map((log) => (
              <ToolCallCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
