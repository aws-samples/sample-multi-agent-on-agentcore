"""HR MCP Server - HR agent wrapped in MCP protocol.

Exposes an agent wrapper tool for natural language query processing.
User identity is propagated via HTTP headers and contextvars.
"""

import asyncio
import logging

import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse
from starlette.routing import Route

from agent import process_query
from shared.user_context import UserContextMiddleware, get_current_username

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

for _name in ["opentelemetry", "amazon.opentelemetry", "strands.agent.agent", "strands.tools"]:
    logging.getLogger(_name).setLevel(logging.WARNING)

mcp = FastMCP(host="0.0.0.0", port=8000, stateless_http=True)


@mcp.tool()
def hr_agent(query: str) -> str:
    """Handle human resources queries including employee profiles, PTO balances and requests, performance review status and submissions, open job positions, and onboarding checklists. Use this agent for anything related to HR policies, leave management, or employee lifecycle."""
    username = get_current_username()
    logger.info(f"hr_agent called: username={username}")
    return process_query(query, user_id=username if username != "unknown" else None)


starlette_app = mcp.streamable_http_app()
starlette_app.routes.insert(0, Route("/ping", lambda r: JSONResponse({"status": "ok"}), methods=["GET"]))
app = UserContextMiddleware(starlette_app)


async def main():
    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
