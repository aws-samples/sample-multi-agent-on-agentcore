import type { SSEEvent } from "../types";

/**
 * POST /api/chat as SSE stream. Calls `onEvent` for each parsed event.
 * Returns an AbortController so the caller can cancel.
 */
export function streamChat(
  params: {
    message: string;
    userId: string;
    sessionId: string;
    token: string;
    useSearch?: boolean;
  },
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.token}`,
        },
        body: JSON.stringify({
          message: params.message,
          user_id: params.userId,
          session_id: params.sessionId,
          use_search: params.useSearch ?? false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Chat request failed: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const event: SSEEvent = JSON.parse(trimmed.slice(6));
              onEvent(event);
            } catch {
              // skip malformed
            }
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim().startsWith("data: ")) {
        try {
          const event: SSEEvent = JSON.parse(buffer.trim().slice(6));
          onEvent(event);
        } catch {
          // skip
        }
      }

      onDone();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onError(err as Error);
      }
    }
  })();

  return controller;
}
