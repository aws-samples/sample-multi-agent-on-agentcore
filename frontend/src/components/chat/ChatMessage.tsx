import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";
import type { ChatMessage as ChatMessageType } from "../../types";
import { User, Bot } from "lucide-react";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3 animate-slide-up", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
          isUser ? "bg-primary/20" : "bg-accent/20"
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-primary" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-accent" />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-primary/10 text-foreground"
            : "bg-card text-foreground border border-border"
        )}
      >
        {isUser ? (
          <p>{message.content}</p>
        ) : isStreaming && !message.content ? (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse [animation-delay:300ms]" />
          </div>
        ) : (
          <div className="chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && message.content && (
              <span className="cursor-blink" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
