"use client";

import { useState, useCallback } from "react";
import { Search, Wrench, Loader2 } from "lucide-react";
import { resolveAgentKey, getAgentLabel, getAgentColor } from "../../lib/constants";
import { cn } from "../../lib/utils";

interface SearchResult {
  name: string;
  description?: string;
}

interface ToolSearchPanelProps {
  token: string;
}

export function ToolSearchPanel({ token }: ToolSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<Record<string, unknown> | null>(null);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setRawResponse(null);
    try {
      const res = await fetch("/api/gateway/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      const data = await res.json();
      setRawResponse(data);

      // Parse results from tool_result content
      const content = data.result?.content;
      if (Array.isArray(content)) {
        const textItem = content.find(
          (c: { type: string }) => c.type === "text"
        );
        if (textItem?.text) {
          try {
            const parsed = JSON.parse(textItem.text);
            setResults(Array.isArray(parsed) ? parsed : parsed.tools || []);
          } catch {
            setResults([]);
          }
        } else {
          setResults([]);
        }
      } else {
        setResults([]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, token]);

  return (
    <div className="h-full flex flex-col">
      {/* Section header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Search className="w-3 h-3 text-muted-foreground" />
        <h3 className="font-display font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
          Semantic Tool Search
        </h3>
      </div>

      {/* Search input */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 bg-muted rounded px-2.5 py-1.5">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. find customer information"
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder-muted-foreground outline-none font-body"
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            className={cn(
              "p-0.5 rounded transition-colors",
              query.trim() && !loading
                ? "text-accent hover:bg-accent/10"
                : "text-muted-foreground"
            )}
          >
            {loading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Search className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {error && (
          <div className="text-[13px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {results !== null && results.length === 0 && !error && (
          <p className="text-[13px] text-muted-foreground text-center py-3">
            No matching tools found.
          </p>
        )}

        {results && results.length > 0 && (
          <>
            <p className="text-[11px] text-muted-foreground">
              {results.length} tool{results.length > 1 ? "s" : ""} matched
            </p>
            {results.map((tool, i) => {
              const agentKey = resolveAgentKey(tool.name);
              const colorClass = getAgentColor(agentKey);
              const label = getAgentLabel(agentKey);
              const shortName = tool.name.includes("___")
                ? tool.name.split("___").pop()
                : tool.name;

              return (
                <div
                  key={`${tool.name}-${i}`}
                  className="bg-card border border-border rounded px-2.5 py-1.5 space-y-0.5 animate-slide-up"
                >
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
                    <span className="text-[13px] font-medium text-foreground font-mono truncate">
                      {shortName}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1 py-px rounded-full ml-auto shrink-0",
                        `bg-${colorClass}/15 text-${colorClass}`
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  {tool.description && (
                    <p className="text-[12px] text-muted-foreground leading-snug pl-4">
                      {tool.description}
                    </p>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Raw JSON response (collapsible) */}
        {rawResponse && (
          <details className="mt-2">
            <summary className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
              Raw JSON Response
            </summary>
            <pre className="mt-1 text-[11px] text-muted-foreground bg-muted rounded p-1.5 overflow-x-auto font-mono leading-relaxed">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </details>
        )}

        {results === null && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-5 text-muted-foreground gap-1.5">
            <Search className="w-5 h-5 opacity-30" />
            <p className="text-[13px] text-center max-w-[200px]">
              Search for tools using natural language. The gateway uses semantic search to find relevant matches.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
