import { NextRequest } from "next/server";
import { invokeAgentRuntime } from "@/lib/aws";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { message, user_id, session_id, use_search } = await request.json();

    const authHeader = request.headers.get("authorization") || "";
    const authToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    const agentStream = await invokeAgentRuntime(
      user_id,
      session_id,
      message,
      authToken,
      use_search ?? false
    );

    // Relay the agent stream with keep-alive
    const encoder = new TextEncoder();
    let lastActivity = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        const keepAlive = setInterval(() => {
          if (Date.now() - lastActivity >= 20000) {
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
              lastActivity = Date.now();
            } catch {
              clearInterval(keepAlive);
            }
          }
        }, 20000);

        try {
          const reader = agentStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
            lastActivity = Date.now();
          }
        } catch (err) {
          const errorEvent = `data: ${JSON.stringify({
            type: "error",
            content: (err as Error).message,
          })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          clearInterval(keepAlive);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return Response.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
