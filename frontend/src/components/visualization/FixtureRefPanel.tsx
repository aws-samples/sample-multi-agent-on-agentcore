"use client";

import { useState, useEffect } from "react";
import { ChevronRight, Database, RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface FixtureRefPanelProps {
  username: string | null;
}

/** Domain sections with display labels and agent color classes */
const DOMAINS: { key: string; label: string; color: string }[] = [
  { key: "hr", label: "HR", color: "agent-hr" },
  { key: "it_support", label: "IT Support", color: "agent-it" },
  { key: "finance", label: "Finance", color: "agent-finance" },
  { key: "productivity", label: "Productivity", color: "agent-productivity" },
  { key: "knowledge", label: "Knowledge", color: "agent-knowledge" },
];

function formatKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Render a dict/object as a key-value card */
function ObjectCard({ data }: { data: Record<string, any> }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {Object.entries(data).map(([k, v]) => {
        if (typeof v === "object" && v !== null) return null;
        return (
          <div key={k} className="contents">
            <span className="text-[10px] text-muted-foreground truncate">
              {formatKey(k)}
            </span>
            <span className="text-[10px] text-foreground truncate">
              {v != null ? String(v) : "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Render an array of objects as a mini table */
function MiniTable({ data }: { data: Record<string, any>[] }) {
  if (data.length === 0) return <p className="text-[10px] text-muted-foreground">No records</p>;

  const columns = Array.from(new Set(data.flatMap((row) => Object.keys(row))));
  // Filter out complex nested objects for display
  const displayCols = columns.filter((col) => {
    return data.every((row) => {
      const v = row[col];
      return v === null || v === undefined || typeof v !== "object" || Array.isArray(v);
    });
  });

  return (
    <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-border">
            {displayCols.map((col) => (
              <th
                key={col}
                className="text-left py-1 px-1.5 text-muted-foreground font-medium uppercase tracking-wide text-[9px] whitespace-nowrap"
              >
                {formatKey(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-border/30 last:border-0">
              {displayCols.map((col) => (
                <td
                  key={col}
                  className="py-1 px-1.5 text-foreground truncate max-w-[140px]"
                >
                  {row[col] != null
                    ? Array.isArray(row[col])
                      ? (row[col] as any[]).join(", ")
                      : String(row[col])
                    : "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Collapsible section for a single data key within a domain */
function DataSection({
  label,
  data,
}: {
  label: string;
  data: any;
}) {
  const [open, setOpen] = useState(false);
  const isArray = Array.isArray(data);
  const isObject = typeof data === "object" && data !== null && !isArray;
  const isEmpty = isArray ? data.length === 0 : isObject ? Object.keys(data).length === 0 : !data;

  if (isEmpty) return null;

  const count = isArray ? data.length : null;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 w-full text-left py-0.5 group"
      >
        <ChevronRight
          className={cn(
            "w-2.5 h-2.5 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="text-[10px] font-medium text-foreground">
          {label}
        </span>
        {count !== null && (
          <span className="text-[9px] text-muted-foreground">({count})</span>
        )}
      </button>
      {open && (
        <div className="ml-3.5 mt-1 mb-2">
          {isArray ? <MiniTable data={data} /> : <ObjectCard data={data} />}
        </div>
      )}
    </div>
  );
}

export function FixtureRefPanel({ username }: FixtureRefPanelProps) {
  const [fixtures, setFixtures] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(null);
    fetch(`/api/fixtures?username=${encodeURIComponent(username)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        return res.json();
      })
      .then((data) => setFixtures(data))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [username]);

  const toggleDomain = (key: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!username) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Database className="w-10 h-10 opacity-30" />
        <p className="text-sm font-display">Log in to view reference data</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading fixtures...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-[11px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
          {error}
        </div>
      </div>
    );
  }

  if (!fixtures) return null;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      {/* User profile */}
      {fixtures.user && (
        <div className="bg-card border border-border rounded-lg px-3 py-2 mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
              {(fixtures.user.name || username)[0].toUpperCase()}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-foreground">{fixtures.user.name}</p>
              <p className="text-[9px] text-muted-foreground">
                {fixtures.user.title} &middot; {fixtures.user.department} &middot; {fixtures.user.employee_id}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Domain sections */}
      {DOMAINS.map(({ key, label, color }) => {
        const domainData = fixtures[key];
        if (!domainData) return null;

        const isExpanded = expandedDomains.has(key);
        const sectionKeys = Object.keys(domainData);
        const nonEmptyCount = sectionKeys.filter((k) => {
          const v = domainData[k];
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object" && v !== null) return Object.keys(v).length > 0;
          return !!v;
        }).length;

        return (
          <div key={key} className="border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => toggleDomain(key)}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 bg-card hover:bg-card/80 transition-colors"
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", `bg-${color}`)} />
              <ChevronRight
                className={cn(
                  "w-3 h-3 text-muted-foreground transition-transform",
                  isExpanded && "rotate-90"
                )}
              />
              <span
                className={cn(
                  "text-[11px] font-semibold font-display uppercase tracking-wider",
                  `text-${color}`
                )}
              >
                {label}
              </span>
              <span className="text-[9px] text-muted-foreground ml-auto">
                {nonEmptyCount} section{nonEmptyCount !== 1 ? "s" : ""}
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 py-2 space-y-1 border-t border-border bg-background/50">
                {sectionKeys.map((sectionKey) => (
                  <DataSection
                    key={sectionKey}
                    label={formatKey(sectionKey)}
                    data={domainData[sectionKey]}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
