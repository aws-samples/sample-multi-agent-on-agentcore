"""IT Support MCP Server - IT Support agent wrapped in MCP protocol."""

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
def it_support_agent(query: str) -> str:
    """Handle IT support queries including creating and tracking support tickets, requesting software access, submitting equipment requests, reviewing current software and hardware inventory, and checking the status of IT services like email, VPN, GitHub, and Jira. Use this agent for any technical issues or IT resource requests."""
    username = get_current_username()
    logger.info(f"it_support_agent called: username={username}")
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
