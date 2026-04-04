import { useState, useCallback } from "react";
import { Send } from "lucide-react";
import { cn } from "../../lib/utils";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  isStreaming: boolean;
}

export function ChatInput({ onSend, disabled, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

  return (
    <div className="border-t border-border p-3 shrink-0">
      <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={
            disabled
              ? "Login to start chatting..."
              : "Ask about HR, IT, Finance, Productivity, or Knowledge..."
          }
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none font-body"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "p-1.5 rounded transition-colors",
            value.trim() && !disabled
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground"
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
      {isStreaming && (
        <p className="text-[10px] text-muted-foreground mt-1 ml-1 font-mono">
          Streaming response...
        </p>
      )}
    </div>
  );
}
