"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Brain,
  RefreshCw,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  Database,
  MessageSquare,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/utils";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface MemoryRecord {
  memoryRecordId: string;
  text: string;
  strategyId: string;
  namespaces: string[];
  createdAt?: string;
  score?: number;
}

interface MemoryData {
  strategies: Record<string, MemoryRecord[]>;
  total: number;
}

interface EventTurn {
  type: "text" | "tool_call";
  role: "user" | "assistant";
  text: string;
}

interface SessionEvent {
  eventId: string;
  turns: EventTurn[];
  createdAt?: string;
}

interface MemorySession {
  sessionId: string;
  createdAt?: string;
  events: SessionEvent[];
}

interface MemoryPanelProps {
  users: Record<string, { name: string; employee_id: string }>;
  currentUsername: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;

const STRATEGY_LABELS: Record<string, string> = {
  preferences: "User Preferences",
  facts: "Semantic Facts",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function getStrategyLabel(key: string): string {
  if (STRATEGY_LABELS[key]) return STRATEGY_LABELS[key];
  const lower = key.toLowerCase();
  if (lower.includes("summary") || lower.includes("conversation")) return "Conversation Summary";
  if (lower.includes("episodic")) return "Episodic Memory";
  if (lower.includes("preference")) return "User Preferences";
  if (lower.includes("semantic") || lower.includes("fact")) return "Semantic Facts";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function EventItem({ event }: { event: SessionEvent }) {
  return (
    <div className="px-3 py-2 space-y-1.5">
      {event.createdAt && (
        <span className="text-[10px] text-muted-foreground">
          {new Date(event.createdAt).toLocaleTimeString()}
        </span>
      )}
      {event.turns.map((turn, i) => (
        <div key={i} className="flex gap-2 text-[12px]">
          {/* Role label */}
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold uppercase tracking-wider mt-0.5 w-16 text-right",
              turn.role === "user" ? "text-blue-500" : "text-accent"
            )}
          >
            {turn.role}
          </span>

          {/* Content */}
          {turn.type === "tool_call" ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground bg-muted rounded px-1.5 py-0.5 font-mono">
              <Wrench className="w-2.5 h-2.5 shrink-0" />
              {turn.text}
            </span>
          ) : (
            <p className="text-foreground/80 leading-relaxed flex-1 min-w-0 break-words whitespace-pre-wrap">
              {turn.text}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function SessionSection({
  session,
  onDelete,
  deleting,
}: {
  session: MemorySession;
  onDelete: (sessionId: string) => void;
  deleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shortId = session.sessionId.slice(-12);

  return (
    <div className="border border-border rounded overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity"
        >
          {open ? (
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
          )}
          <MessageSquare className="w-3 h-3 text-accent shrink-0" />
          <span className="text-[12px] font-mono text-foreground truncate max-w-[120px]">
            ...{shortId}
          </span>
          {session.createdAt && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {new Date(session.createdAt).toLocaleDateString()}
            </span>
          )}
          <span className="ml-2 text-[11px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
            {session.events.length}
          </span>
        </button>
        <button
          onClick={() => onDelete(session.sessionId)}
          disabled={deleting}
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
          title="Delete session"
        >
          {deleting ? (
            <RefreshCw className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
        </button>
      </div>

      {open && (
        <div className="divide-y divide-border">
          {session.events.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-muted-foreground">
              No events in this session.
            </p>
          ) : (
            session.events.map((event) => (
              <EventItem key={event.eventId} event={event} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StrategySection({
  name,
  records,
  defaultOpen,
}: {
  name: string;
  records: MemoryRecord[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-card hover:bg-muted/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <Database className="w-3 h-3 text-accent shrink-0" />
        <span className="text-[13px] font-semibold text-foreground font-display uppercase tracking-wider">
          {getStrategyLabel(name)}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
          {records.length}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-border">
          {records.map((record) => (
            <div key={record.memoryRecordId} className="px-3 py-2 space-y-0.5">
              <p className="text-[13px] text-foreground leading-relaxed">
                {record.text}
              </p>
              <div className="flex items-center gap-2">
                {record.createdAt && (
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(record.createdAt).toLocaleDateString()}
                  </span>
                )}
                {record.score != null && record.score > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    score: {record.score.toFixed(3)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MemoryPanel({ users, currentUsername }: MemoryPanelProps) {
  const [selectedUser, setSelectedUser] = useState<string | null>(currentUsername);

  useEffect(() => {
    setSelectedUser(currentUsername);
    setSessions([]);
    setData(null);
    setError(null);
    setConfirmClear(false);
    setSearchQuery("");
    setLastUpdated(null);
  }, [currentUsername]);
  const [tab, setTab] = useState<"events" | "records">("events");

  // Unified snapshot state (populated by polling)
  const [sessions, setSessions] = useState<MemorySession[]>([]);
  const [data, setData] = useState<MemoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Records tab actions
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Events tab actions
  const [deletingSession, setDeletingSession] = useState<string | null>(null);

  // ── Snapshot fetch (used by both initial load and polling) ─────────────────

  const fetchSnapshot = useCallback(
    async (showLoading = false) => {
      if (!selectedUser) return;
      if (showLoading) setLoading(true);
      setError(null);
      setConfirmClear(false);
      try {
        const res = await fetch(
          `/api/memory/snapshot?user=${selectedUser}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Failed: ${res.status}`);
        }
        const result = await res.json();
        setSessions(result.events?.sessions || []);
        setData(result.records || null);
        setLastUpdated(new Date());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [selectedUser]
  );

  // ── Unified polling: initial load + 5s interval ───────────────────────────

  useEffect(() => {
    if (!selectedUser) return;
    fetchSnapshot(true); // show loading spinner on first fetch
    const id = setInterval(() => fetchSnapshot(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedUser, fetchSnapshot]);

  // ── Semantic search (Records tab only) ────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!selectedUser || !searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        user: selectedUser,
        q: searchQuery.trim(),
      });
      const res = await fetch(`/api/memory?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedUser, searchQuery]);

  // ── Clear all memory records ───────────────────────────────────────────────

  const handleClear = useCallback(async () => {
    if (!selectedUser) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    setError(null);
    setConfirmClear(false);
    try {
      const res = await fetch(`/api/memory?user=${selectedUser}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Failed: ${res.status}`);
      }
      await res.json();
      await fetchSnapshot(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setClearing(false);
    }
  }, [selectedUser, confirmClear, fetchSnapshot]);

  // ── Delete a single session's events ─────────────────────────────────────

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!selectedUser) return;
      setDeletingSession(sessionId);
      setError(null);
      try {
        const res = await fetch(
          `/api/memory?user=${selectedUser}&sessionId=${encodeURIComponent(sessionId)}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Failed: ${res.status}`);
        }
        // Optimistically remove from local state; polling will confirm
        setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setDeletingSession(null);
      }
    },
    [selectedUser]
  );

  const strategyEntries = data ? Object.entries(data.strategies) : [];
  const hasRecords = strategyEntries.some(([, recs]) => recs.length > 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-10 border-b border-border shrink-0">
        <Brain className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="font-display font-semibold text-xs text-foreground">
          Memory
        </span>
        {/* Polling indicator */}
        {selectedUser && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            {loading ? (
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
            ) : lastUpdated ? (
              <span>{lastUpdated.toLocaleTimeString()}</span>
            ) : null}
          </span>
        )}
        <div className="flex-1" />
        {selectedUser && users[selectedUser] && (
          <span className="text-xs text-muted-foreground">
            {users[selectedUser].name}
          </span>
        )}
      </div>

      {/* Tab bar */}
      {selectedUser && (
        <div className="flex border-b border-border shrink-0">
          <button
            onClick={() => setTab("events")}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              tab === "events"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Events
          </button>
          <button
            onClick={() => setTab("records")}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
              tab === "records"
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Records
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!selectedUser && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-4">
            <Brain className="w-10 h-10 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Memory Explorer
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-[280px]">
                Log in to view stored memories.
              </p>
            </div>
          </div>
        )}

        {/* ===== Events Tab ===== */}
        {selectedUser && tab === "events" && (
          <>
            <div className="px-3 py-2 border-b border-border shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => fetchSnapshot(true)}
                  disabled={loading}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium transition-colors border",
                    "bg-accent/15 text-accent border-accent/30 hover:bg-accent/25 disabled:opacity-30"
                  )}
                >
                  <RefreshCw
                    className={cn("w-2.5 h-2.5", loading && "animate-spin")}
                  />
                  {loading ? "Loading..." : "Refresh"}
                </button>
                {lastUpdated && !loading && (
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {sessions.length} session{sessions.length !== 1 ? "s" : ""}
                    {" · "}
                    {sessions.reduce((n, s) => n + s.events.length, 0)} event
                    {sessions.reduce((n, s) => n + s.events.length, 0) !== 1
                      ? "s"
                      : ""}
                  </span>
                )}
              </div>
            </div>

            {error && (
              <div className="mx-3 mt-2 text-[13px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
                {error}
              </div>
            )}

            {loading && sessions.length === 0 && (
              <div className="flex items-center justify-center mt-10 gap-2 text-muted-foreground">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[13px]">Loading events...</span>
              </div>
            )}

            {!loading && lastUpdated && sessions.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6 gap-3">
                <MessageSquare className="w-8 h-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  No sessions found for{" "}
                  {users[selectedUser]?.name || selectedUser}.
                </p>
              </div>
            )}

            {sessions.length > 0 && (
              <div className="p-3 space-y-2">
                {sessions.map((session) => (
                  <SessionSection
                    key={session.sessionId}
                    session={session}
                    onDelete={handleDeleteSession}
                    deleting={deletingSession === session.sessionId}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== Records Tab ===== */}
        {selectedUser && tab === "records" && (
          <>
            <div className="px-3 py-2 border-b border-border space-y-2 shrink-0">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Search memories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1 bg-muted text-foreground text-[13px] rounded px-2 py-1 border border-border outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !searchQuery.trim()}
                  className="text-muted-foreground hover:text-accent transition-colors disabled:opacity-30 p-1"
                  title="Search"
                >
                  <Search className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setSearchQuery("");
                    fetchSnapshot(true);
                  }}
                  disabled={loading}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium transition-colors border",
                    "bg-accent/15 text-accent border-accent/30 hover:bg-accent/25 disabled:opacity-30"
                  )}
                >
                  <RefreshCw
                    className={cn("w-2.5 h-2.5", loading && "animate-spin")}
                  />
                  {loading ? "Loading..." : "Refresh"}
                </button>
                <div className="flex-1" />
                {confirmClear ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-red-400">Confirm?</span>
                    <button
                      onClick={handleClear}
                      disabled={clearing}
                      className="px-2 py-0.5 rounded text-[12px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-30"
                    >
                      {clearing ? "Clearing..." : "Yes, clear"}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-0.5 rounded text-[12px] font-medium text-muted-foreground border border-border hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleClear}
                    disabled={clearing || !data || !hasRecords}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[12px] font-medium transition-colors border text-red-400 border-red-500/30 hover:bg-red-500/15 disabled:opacity-30"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                    Clear
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="mx-3 mt-2 text-[13px] text-red-400 bg-red-400/10 rounded px-2 py-1.5">
                {error}
              </div>
            )}

            {loading && !data && (
              <div className="flex items-center justify-center mt-10 gap-2 text-muted-foreground">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[13px]">Loading memories...</span>
              </div>
            )}

            {data && !hasRecords && !loading && (
              <div className="flex flex-col items-center justify-center h-48 text-center p-6 gap-3">
                <Brain className="w-8 h-8 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  No memories found for{" "}
                  {users[selectedUser]?.name || selectedUser}.
                </p>
              </div>
            )}

            {data && hasRecords && (
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
                    {data.total} record{data.total !== 1 ? "s" : ""} found
                  </span>
                </div>
                {strategyEntries
                  .filter(([, recs]) => recs.length > 0)
                  .map(([name, records]) => (
                    <StrategySection
                      key={name}
                      name={name}
                      records={records}
                      defaultOpen
                    />
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
