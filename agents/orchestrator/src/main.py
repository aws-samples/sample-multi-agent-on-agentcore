"""Concierge Agent Core Service.

Implements AgentCore Runtime required endpoints:
- POST /invocations: Process agent requests with SSE streaming
- GET /ping: Health check

Uses agent.stream_async() to capture all event types (tool_use with input,
tool_result, text chunks) for rich frontend display.
"""

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Add src directory to Python path
src_path = Path(__file__).parent
if str(src_path) not in sys.path:
    sys.path.insert(0, str(src_path))

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Filter health check from access logs
class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return "/ping" not in msg


logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

# Suppress verbose library logs
logging.getLogger("strands.agent.agent").setLevel(logging.WARNING)
logging.getLogger("strands.tools.mcp").setLevel(logging.WARNING)

# Suppress OpenTelemetry auto-instrumentation noise
for _otel_logger in [
    "opentelemetry",
    "opentelemetry.sdk",
    "opentelemetry.exporter",
    "opentelemetry.instrumentation",
    "opentelemetry.trace",
    "opentelemetry.metrics",
    "opentelemetry.context",
    "amazon.opentelemetry",
]:
    logging.getLogger(_otel_logger).setLevel(logging.WARNING)


# AgentCore Runtime header names
HEADER_USER_ID = "X-Amzn-Bedrock-AgentCore-Runtime-User-Id"
HEADER_SESSION_ID = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"


# Request body — user_id and auth_token are sent in the payload body
# because AgentCore Runtime does not forward runtimeUserId as an HTTP header.
# session_id is available via the X-Amzn-Bedrock-AgentCore-Runtime-Session-Id header.
class InvocationInput(BaseModel):
    message: str = ""
    model_id: Optional[str] = None
    auth_token: Optional[str] = None
    user_id: Optional[str] = None
    session_id: Optional[str] = None


def _is_input_complete(tool_input) -> tuple[bool, dict]:
    """Check if tool input is complete (valid JSON dict)."""
    if isinstance(tool_input, dict) and len(tool_input) > 0:
        return True, tool_input
    if isinstance(tool_input, str):
        if tool_input in ("", "{}"):
            return True, {}
        try:
            parsed = json.loads(tool_input)
            if isinstance(parsed, dict):
                return True, parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return False, {}


def _extract_tool_result_text(tool_result: dict) -> str:
    """Extract text content from a toolResult content list."""
    parts = []
    for item in tool_result.get("content", []):
        if isinstance(item, dict) and "text" in item:
            parts.append(item["text"])
    return "\n".join(parts)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("=== Concierge Agent Service Starting ===")

    # Create sessions directory for local development
    sessions_dir = Path(__file__).parent.parent / "sessions"
    sessions_dir.mkdir(exist_ok=True)
    logger.info("Sessions directory ready")

    yield

    logger.info("=== Concierge Agent Service Shutting Down ===")


app = FastAPI(
    title="Concierge Agent",
    version="1.0.0",
    description="Multi-agent concierge with dynamic agent discovery via Registry and invocation via Gateway",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


async def stream_agent_response(
    session_id: str,
    user_id: str,
    message: str,
    model_id: Optional[str] = None,
    auth_token: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream agent response as SSE events using stream_async().

    Event types emitted:
      tool_use   — {"type":"tool_use", "name":"...", "input":{...}}
      tool_result— {"type":"tool_result", "name":"...", "content":"..."}
      text       — {"type":"text", "content":"..."}
      error      — {"type":"error", "content":"..."}
      done       — {"type":"done"}
    """
    from agent import create_orchestrator_agent

    use_memory_retrieval = os.environ.get("USE_MEMORY_RETRIEVAL", "false").lower() == "true"

    agent = create_orchestrator_agent(
        session_id=session_id,
        user_id=user_id,
        model_id=model_id,
        auth_token=auth_token,
        use_memory_retrieval=use_memory_retrieval,
    )

    seen_tools: set[str] = set()
    # Map toolUseId -> tool name (to attach name to tool_result events)
    tool_id_to_name: dict[str, str] = {}
    # Map toolUseId -> input (captured from message event for complete input)
    tool_id_to_input: dict[str, dict] = {}

    try:
        async for event in agent.stream_async(message):

            # --- Message (capture complete tool use with input) ---
            if "message" in event:
                msg = event["message"]
                content = (
                    msg.content if hasattr(msg, "content")
                    else msg.get("content", []) if isinstance(msg, dict)
                    else []
                ) or []

                # First pass: extract toolUse items to capture complete input
                for item in content:
                    if isinstance(item, dict) and "toolUse" in item:
                        tool_use = item["toolUse"]
                        tool_id = tool_use.get("toolUseId", "")
                        tool_name = tool_use.get("name", "")
                        tool_input = tool_use.get("input", {})

                        if tool_id and tool_name:
                            tool_id_to_name[tool_id] = tool_name
                            tool_id_to_input[tool_id] = tool_input

                            # Emit tool_use event with complete input
                            key = f"{tool_name}:{tool_id}"
                            if key not in seen_tools:
                                seen_tools.add(key)
                                yield _sse({"type": "tool_use", "name": tool_name, "input": tool_input})

                # Second pass: handle tool results
                for item in content:
                    if isinstance(item, dict) and "toolResult" in item:
                        tr = item["toolResult"]
                        tool_use_id = tr.get("toolUseId", "")
                        result_text = _extract_tool_result_text(tr)
                        tool_name = tool_id_to_name.get(tool_use_id, "")
                        yield _sse({
                            "type": "tool_result",
                            "name": tool_name,
                            "content": result_text,
                        })

            # --- Text chunk ---
            elif "data" in event and not event.get("reasoning"):
                yield _sse({"type": "text", "content": event["data"]})

            # --- Final result (last event; let generator exit naturally) ---
            elif "result" in event:
                pass

    except Exception as e:
        logger.error(f"Agent error: {e}", exc_info=True)
        yield _sse({"type": "error", "content": "An internal error occurred. Check server logs for details."})

    yield _sse({"type": "done"})


@app.post("/invocations")
async def invocations(request: Request):
    """Main endpoint for agent invocations.

    Required by AgentCore Runtime. Accepts user message and returns
    SSE streaming response with agent output.

    Session ID and User ID are received via AgentCore Runtime headers
    (runtimeSessionId / runtimeUserId SDK parameters).
    auth_token (user JWT) is sent in the payload body for Gateway CUSTOM_JWT auth.
    """
    body = await request.json()
    input_data = InvocationInput(**(body.get("input", body)))

    # Prefer payload body (reliable), fall back to AgentCore Runtime headers
    session_id = input_data.session_id or request.headers.get(HEADER_SESSION_ID) or "default_session"
    user_id = input_data.user_id or request.headers.get(HEADER_USER_ID) or "default_user"

    logger.info(
        f"Invocation: session={session_id}, "
        f"user={user_id}, message_len={len(input_data.message)}"
    )

    if not input_data.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    if len(input_data.message) > 10000:
        raise HTTPException(status_code=400, detail="Message too long (max 10000 characters)")

    return StreamingResponse(
        stream_agent_response(
            session_id=session_id,
            user_id=user_id,
            message=input_data.message,
            model_id=input_data.model_id,
            auth_token=input_data.auth_token,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/ping")
async def ping():
    """Health check endpoint required by AgentCore Runtime."""
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8080,
        log_level="info",
    )
