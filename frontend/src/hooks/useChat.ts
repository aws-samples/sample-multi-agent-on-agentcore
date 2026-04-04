import { useState, useCallback, useRef } from "react";
import { v4 } from "../lib/uuid";
import type {
  ChatMessage,
  ToolCall,
  SSEEvent,
} from "../types";
import { streamChat } from "../api/chat";
import { resolveAgentKey, getAgentLabel } from "../lib/constants";

export function useChat(
  token: string | null,
  userId: string | null,
  onNotification: (msg: string, agent?: string, type?: "info" | "error") => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState(() => `session-${v4()}`);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCall[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Map tool_use_id → { localId, agentKey, startTime } for parallel tool call tracking
  const toolCallMapRef = useRef<Map<string, { localId: string; agentKey: string; startTime: number }>>(new Map());

  const sendMessage = useCallback(
    (text: string) => {
      if (!token || !userId || isStreaming) return;

      const userMsg: ChatMessage = {
        id: v4(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      const assistantMsg: ChatMessage = {
        id: v4(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);
      setActiveToolCalls([]);
      setLastUserMessage(text);
      toolCallMapRef.current.clear();

      const assistantId = assistantMsg.id;

      const handleEvent = (event: SSEEvent) => {
        switch (event.type) {
          case "tool_use": {
            const rawName = event.name || "";
            const agentKey = resolveAgentKey(rawName);
            const label = getAgentLabel(rawName);
            const toolUseId = event.tool_use_id || rawName;

            const localId = v4();
            toolCallMapRef.current.set(toolUseId, { localId, agentKey, startTime: Date.now() });

            const tc: ToolCall = {
              id: localId,
              name: agentKey,
              agentName: label,
              input: event.input,
              isActive: true,
              timestamp: Date.now(),
            };
            setActiveToolCalls((prev) => [...prev, tc]);

            // Log tool call start
            fetch("/api/toolcalls", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: localId,
                user: userId,
                sessionId,
                toolName: rawName,
                agentName: label,
                input: event.input,
              }),
            }).catch((err) => console.error("Failed to log tool call:", err));

            onNotification(`${label} invoked`, agentKey, "info");
            break;
          }
          case "tool_result": {
            const toolUseId = event.tool_use_id || event.name || "";
            const tracked = toolCallMapRef.current.get(toolUseId);
            const localId = tracked?.localId;
            const agentKey = tracked?.agentKey || "";
            const duration = tracked ? Date.now() - tracked.startTime : 0;

            // Deactivate the specific tool call
            setActiveToolCalls((prev) =>
              prev.map((t) => t.id === localId ? { ...t, isActive: false } : t)
            );

            // Add paragraph break so next text block starts on a new line
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId && m.content
                  ? { ...m, content: m.content + "\n\n" }
                  : m
              )
            );

            // Log tool call completion
            if (localId) {
              fetch("/api/toolcalls", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  id: localId,
                  output: event.content,
                  duration,
                }),
              }).catch((err) => console.error("Failed to update tool call:", err));
            }

            const label = getAgentLabel(agentKey);
            onNotification(`${label} completed`, agentKey, "info");
            break;
          }
          case "text": {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + (event.content || "") }
                  : m
              )
            );
            break;
          }
          case "error": {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + (event.content || "") }
                  : m
              )
            );
            onNotification(event.content || "Error", undefined, "error");
            break;
          }
          case "done": {
            // handled in onDone
            break;
          }
        }
      };

      controllerRef.current = streamChat(
        { message: text, userId, sessionId, token, useSearch: false },
        handleEvent,
        () => {
          setIsStreaming(false);
          setActiveToolCalls((prev) =>
            prev.map((t) => ({ ...t, isActive: false }))
          );
        },
        (err) => {
          setIsStreaming(false);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || `Error: ${err.message}` }
                : m
            )
          );
          onNotification(err.message, undefined, "error");
        }
      );
    },
    [token, userId, sessionId, isStreaming, onNotification]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setActiveToolCalls([]);
    setLastUserMessage(null);
    setSessionId(`session-${v4()}`);
  }, []);

  return {
    messages,
    sessionId,
    isStreaming,
    activeToolCalls,
    lastUserMessage,
    sendMessage,
    clearChat,
  };
}
