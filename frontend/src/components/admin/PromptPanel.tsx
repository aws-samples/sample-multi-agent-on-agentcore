"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Terminal, MessageSquare, RefreshCw, User, Bot, Wrench } from "lucide-react";
import { cn } from "../../lib/utils";

interface PromptPanelProps {
  lastUserMessage: string | null;
  sessionId: string | null;
  username: string | null;
  isStreaming: boolean;
}

// ── XML section parser ────────────────────────────────────────────────────────

interface PromptSection {
  tag: string | null;
  content: string;
}

function parsePromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = [];
  const xmlRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = xmlRe.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const pre = prompt.slice(lastIndex, match.index).trim();
      if (pre) sections.push({ tag: null, content: pre });
    }
    sections.push({ tag: match[1], content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }

  const tail = prompt.slice(lastIndex).trim();
  if (tail) sections.push({ tag: null, content: tail });

  return sections;
}

const TAG_STYLES: Record<string, { label: string; color: string }> = {
  tool_usage:         { label: "Tool Usage",         color: "text-blue-400" },
  response_approach:  { label: "Response Approach",  color: "text-emerald-400" },
  communication_style:{ label: "Communication Style",color: "text-violet-400" },
};

// ── History types ─────────────────────────────────────────────────────────────

interface ConversationTurn {
  type: "text" | "tool_call";
  role: "user" | "assistant";
  text: string;
}

interface HistoryEvent {
  eventId: string;
  turns: ConversationTurn[];
  createdAt?: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionBlock({ section }: { section: PromptSection }) {
  const [open, setOpen] = useState(true);
  const meta = section.tag ? TAG_STYLES[section.tag] : null;

  if (!section.tag) {
    return (
      <pre className="text-[12px] text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono">
        {section.content}
      </pre>
    );
  }

  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/40 hover:bg-muted/70 transition-colors"
      >
        {open
          ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        <span className={cn("text-[11px] font-mono font-semibold", meta?.color ?? "text-muted-foreground")}>
          &lt;{section.tag}&gt;
        </span>
        {meta && (
          <span className="text-[11px] text-muted-foreground">{meta.label}</span>
        )}
      </button>
      {open && (
        <pre className="px-3 py-2 text-[12px] text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono border-t border-border bg-background/50">
          {section.content}
        </pre>
      )}
    </div>
  );
}

function TurnBubble({ turn }: { turn: ConversationTurn }) {
  const isUser = turn.role === "user";
  const isToolCall = turn.type === "tool_call";

  return (
    <div className={cn("flex gap-2 items-start", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5",
        isUser ? "bg-primary/15" : isToolCall ? "bg-amber-400/15" : "bg-accent/15"
      )}>
        {isUser
          ? <User className="w-3 h-3 text-primary" />
          : isToolCall
            ? <Wrench className="w-3 h-3 text-amber-400" />
            : <Bot className="w-3 h-3 text-accent" />}
      </div>
      <div className={cn(
        "flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words",
        isUser
          ? "bg-primary/10 text-foreground text-right"
          : isToolCall
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-mono"
            : "bg-muted/60 text-foreground/80"
      )}>
        {isToolCall ? `tool: ${turn.text}` : turn.text}
      </div>
    </div>
  );
}

function PromptCard({
  icon,
  title,
  badge,
  extra,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  title: string;
  badge?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center bg-card hover:bg-muted/40 transition-colors">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 flex items-center gap-2 px-3 py-2 min-w-0"
        >
          {open
            ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
            : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
          <span className="text-accent shrink-0">{icon}</span>
          <span className="text-[12px] font-semibold text-foreground font-display uppercase tracking-wider">
            {title}
          </span>
          {badge && (
            <span className="ml-auto text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
              {badge}
            </span>
          )}
        </button>
        {extra && (
          <span className="px-2 shrink-0">
            {extra}
          </span>
        )}
      </div>
      {open && (
        <div className="border-t border-border bg-background/50">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PromptPanel({ lastUserMessage, sessionId, username, isStreaming }: PromptPanelProps) {
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [chatHistory, setChatHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetch("/api/prompt")
      .then((r) => r.json())
      .then((d) => setSystemPrompt(d.systemPrompt ?? null))
      .catch(() => setSystemPrompt(null))
      .finally(() => setLoading(false));
  }, []);

  const fetchHistory = useCallback(() => {
    if (!username || !sessionId) {
      setChatHistory([]);
      return;
    }
    setHistoryLoading(true);
    fetch(`/api/memory/snapshot?user=${encodeURIComponent(username)}`)
      .then((r) => r.json())
      .then((data) => {
        const sessions: any[] = data.events?.sessions || [];
        const session = sessions.find((s: any) => s.sessionId === sessionId);
        setChatHistory(session?.events || []);
      })
      .catch(() => setChatHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [username, sessionId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-refresh history when streaming completes
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      fetchHistory();
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, fetchHistory]);

  const sections = systemPrompt ? parsePromptSections(systemPrompt) : [];
  const historyTurns: ConversationTurn[] = chatHistory.flatMap((e) => e.turns);

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3">

      {/* System Prompt */}
      <PromptCard
        icon={<Terminal className="w-3.5 h-3.5" />}
        title="System Prompt"
        badge="orchestrator"
      >
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span className="text-[12px]">Loading...</span>
          </div>
        ) : systemPrompt ? (
          <div className="px-3 py-2 space-y-2">
            {sections.map((s, i) => (
              <SectionBlock key={i} section={s} />
            ))}
          </div>
        ) : (
          <p className="px-3 py-2 text-[12px] text-muted-foreground">
            System prompt not found.
          </p>
        )}
      </PromptCard>

      {/* User Prompt — includes loaded history + current message */}
      <PromptCard
        icon={<MessageSquare className="w-3.5 h-3.5" />}
        title="User Prompt"
        badge={username ?? undefined}
        defaultOpen={true}
        extra={
          username && sessionId ? (
            <button
              onClick={fetchHistory}
              disabled={historyLoading}
              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              title="Refresh history"
            >
              <RefreshCw className={cn("w-3 h-3", historyLoading && "animate-spin")} />
            </button>
          ) : undefined
        }
      >
        {!lastUserMessage && historyTurns.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-muted-foreground">
            No message sent yet. Start a conversation to see the user prompt here.
          </p>
        ) : (
          <div className="px-3 py-2 space-y-1.5">
            {/* Metadata */}
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground border-b border-border pb-2 mb-2">
              <span>
                <span className="font-medium text-foreground/60">user</span>{" "}
                {username ?? "—"}
              </span>
              <span>
                <span className="font-medium text-foreground/60">session</span>{" "}
                <span className="font-mono">{sessionId ? `...${sessionId.slice(-12)}` : "—"}</span>
              </span>
              {historyTurns.length > 0 && (
                <span className="text-[10px] text-muted-foreground/70">
                  {historyTurns.length} turns loaded from memory
                </span>
              )}
            </div>

            {/* Previous turns from AgentCore Memory */}
            {historyTurns.map((turn, i) => (
              <TurnBubble key={i} turn={turn} />
            ))}

          </div>
        )}
      </PromptCard>

    </div>
  );
}
