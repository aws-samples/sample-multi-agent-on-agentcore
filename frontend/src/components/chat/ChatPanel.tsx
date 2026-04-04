import type { ChatMessage, ToolCall } from "../../types";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

interface ChatPanelProps {
  messages: ChatMessage[];
  activeToolCalls: ToolCall[];
  isStreaming: boolean;
  isAuthenticated: boolean;
  userName: string | null;
  onSend: (text: string) => void;
}

export function ChatPanel({
  messages,
  activeToolCalls,
  isStreaming,
  isAuthenticated,
  userName,
  onSend,
}: ChatPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <MessageList
        messages={messages}
        activeToolCalls={activeToolCalls}
        isStreaming={isStreaming}
        userName={userName}
        onSend={onSend}
      />
      <ChatInput
        onSend={onSend}
        disabled={!isAuthenticated}
        isStreaming={isStreaming}
      />
    </div>
  );
}
