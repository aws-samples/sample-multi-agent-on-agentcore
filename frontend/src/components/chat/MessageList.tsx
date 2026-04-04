import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType, ToolCall } from "../../types";
import { ChatMessage } from "./ChatMessage";
import { ToolCallBadge } from "./ToolCallBadge";

const SAMPLE_QUESTIONS = [
  { label: "HR", text: "How many PTO days do I have remaining?" },
  { label: "HR", text: "What is the status of my performance review?" },
  { label: "IT", text: "Show my open IT support tickets" },
  { label: "IT", text: "What software licenses do I have access to?" },
  { label: "Finance", text: "What expenses are pending approval?" },
  { label: "Finance", text: "What is my department's budget utilization?" },
  { label: "Productivity", text: "What meetings do I have this week?" },
  { label: "Knowledge", text: "What is the remote work policy?" },
];

interface MessageListProps {
  messages: ChatMessageType[];
  activeToolCalls: ToolCall[];
  isStreaming: boolean;
  userName: string | null;
  onSend: (text: string) => void;
}

export function MessageList({
  messages,
  activeToolCalls,
  isStreaming,
  userName,
  onSend,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm gap-3">
          <p className="font-display text-lg">
            {userName ? `Hi ${userName.split(" ")[0]}, how can I help?` : "Welcome to CONCIERGE"}
          </p>
          <p className="text-xs">Ask about HR, IT support, finance, productivity, or company knowledge.</p>
          <div className="flex flex-wrap justify-center gap-2 mt-3 max-w-md">
            {SAMPLE_QUESTIONS.map((q) => (
              <button
                key={q.text}
                onClick={() => onSend(q.text)}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-xs text-foreground hover:border-primary hover:text-primary transition-colors text-left"
              >
                <span className="text-muted-foreground font-mono text-[10px] mr-1.5">{q.label}</span>
                {q.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.map((msg, i) => {
        const isLastAssistant =
          msg.role === "assistant" && i === messages.length - 1;
        return (
          <ChatMessage
            key={msg.id}
            message={msg}
            isStreaming={isStreaming && isLastAssistant}
          />
        );
      })}

      {/* Active tool calls */}
      {activeToolCalls.length > 0 && (
        <div className="flex flex-wrap gap-2 px-10">
          {activeToolCalls.map((tc) => (
            <ToolCallBadge key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
