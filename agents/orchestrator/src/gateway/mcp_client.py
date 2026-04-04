"""Gateway MCP Client for AgentCore Gateway Tools.

Creates MCP client with Bearer JWT authentication for Gateway tools.
Five sub-agent tools are exposed through the Gateway:
  hr_agent, it_support_agent, finance_agent, productivity_agent, knowledge_agent

Gateway uses CUSTOM_JWT inbound auth — the orchestrator forwards the user's JWT.
Interceptor Lambda extracts JWT claims and propagates x-username, x-user-id,
x-session-id headers to targets. MCP servers read these via ASGI middleware.

FilteredMCPClient supports excluding specific tools (e.g., search) from the
orchestrator's tool list while keeping them available in the Gateway.
"""

import json as _json
import logging
import os
from typing import Callable, Any, List, Optional, Set

import boto3
import httpx
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from strands.tools.mcp import MCPClient

logger = logging.getLogger(__name__)

# Tool names to exclude from the orchestrator's tool list.
# These tools exist in the Gateway but should not be directly invoked by the agent.
EXCLUDED_TOOLS: List[str] = os.environ.get(
    "EXCLUDED_TOOLS", "search"
).split(",")

SEARCH_TOOL_NAME = "x_amz_bedrock_agentcore_search"
SEARCH_TOP_K = 5


class FilteredMCPClient(MCPClient):
    """MCPClient that filters tools from the Gateway tool list.

    Supports two modes:
    - Exclude mode: remove tools matching EXCLUDED_TOOLS patterns.
    - Allow mode: only include tools in allowed_tools set.
    """

    def __init__(
        self,
        client_factory: Callable[[], Any],
        excluded_tools: List[str],
        allowed_tools: Optional[Set[str]] = None,
    ):
        super().__init__(client_factory)
        self.excluded_tools = [t.strip().lower() for t in excluded_tools if t.strip()]
        self.allowed_tools = allowed_tools
        if allowed_tools:
            logger.info(f"FilteredMCPClient: allow-list mode, {len(allowed_tools)} tools: {allowed_tools}")
        else:
            logger.info(f"FilteredMCPClient: exclude mode, patterns: {self.excluded_tools}")

    def _is_excluded(self, tool_name: str) -> bool:
        """Check if a tool name matches any exclusion pattern."""
        name_lower = tool_name.lower()
        for pattern in self.excluded_tools:
            if pattern in name_lower:
                return True
        return False

    def list_tools_sync(self, *args, **kwargs):
        from strands.types import PaginatedList

        all_tools = super().list_tools_sync()

        if self.allowed_tools:
            filtered = [t for t in all_tools if t.tool_name in self.allowed_tools]
            logger.info(
                f"FilteredMCPClient: allow-list kept {len(filtered)}/{len(all_tools)} tools: "
                f"{[t.tool_name for t in filtered]}"
            )
        else:
            filtered = [t for t in all_tools if not self._is_excluded(t.tool_name)]
            excluded_count = len(all_tools) - len(filtered)
            if excluded_count:
                excluded_names = [t.tool_name for t in all_tools if self._is_excluded(t.tool_name)]
                logger.info(f"FilteredMCPClient: excluded {excluded_count} tools: {excluded_names}")

        return PaginatedList(filtered, token=all_tools.pagination_token)


def get_gateway_url() -> Optional[str]:
    """Get Gateway URL from environment variable or SSM Parameter Store."""
    gateway_url = os.environ.get("GATEWAY_URL")
    if gateway_url:
        logger.info(f"Gateway URL from env: {gateway_url}")
        return gateway_url

    project_name = os.environ.get("PROJECT_NAME", "multi-agent-concierge")
    environment = os.environ.get("ENVIRONMENT", "dev")
    region = os.environ.get("AWS_REGION", "us-west-2")

    try:
        ssm = boto3.client("ssm", region_name=region)
        response = ssm.get_parameter(
            Name=f"/{project_name}/{environment}/mcp/gateway-url"
        )
        gateway_url = response["Parameter"]["Value"]
        logger.info(f"Gateway URL from SSM: {gateway_url}")
        return gateway_url
    except Exception as e:
        logger.warning(f"Failed to get Gateway URL from SSM: {e}")
        return None


async def preemptive_search(
    query: str,
    gateway_url: Optional[str] = None,
    auth_token: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    top_k: int = SEARCH_TOP_K,
) -> List[str]:
    """Call Gateway semantic search and return top-k tool names.

    Opens a temporary MCP session, calls the built-in search tool,
    and returns ranked tool names. Falls back to empty list on failure.
    """
    if not gateway_url:
        gateway_url = get_gateway_url()
        if not gateway_url:
            return []

    headers = {}
    if auth_token:
        token = auth_token.removeprefix("Bearer ").strip()
        headers["Authorization"] = f"Bearer {token}"
    if session_id:
        headers["x-session-id"] = session_id
    if user_id:
        headers["x-user-id"] = user_id

    try:
        http_client = httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(30, read=60),
        )
        async with streamable_http_client(gateway_url, http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(SEARCH_TOOL_NAME, {"query": query})

                tool_names = []
                for item in result.content:
                    if hasattr(item, "text"):
                        data = _json.loads(item.text)
                        tools = data.get("tools", [])
                        tool_names = [t["name"] for t in tools[:top_k]]
                        break

                logger.info(f"Preemptive search (top {top_k}) for '{query[:50]}...': {tool_names}")
                return tool_names
    except Exception as e:
        logger.warning(f"Preemptive search failed, falling back to all tools: {e}")
        return []


def create_gateway_mcp_client(
    gateway_url: Optional[str] = None,
    auth_token: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    use_search: bool = False,
    allowed_tools: Optional[List[str]] = None,
) -> Optional[FilteredMCPClient]:
    """Create filtered MCP client for AgentCore Gateway with Bearer JWT auth.

    Args:
        gateway_url: Gateway URL. If None, retrieves from env/SSM.
        auth_token: User JWT to send as Bearer token for Gateway CUSTOM_JWT auth.
        session_id: Application session ID to propagate via custom header.
        user_id: User identifier to propagate via custom header.
        use_search: If True, include the search tool in the agent's tool list.
        allowed_tools: If provided, only include these tools (from preemptive search).

    Returns:
        FilteredMCPClient instance or None if Gateway URL not available
    """
    if not gateway_url:
        gateway_url = get_gateway_url()
        if not gateway_url:
            logger.warning(
                "Gateway URL not available. Gateway tools will not be loaded."
            )
            return None

    headers = {}
    if auth_token:
        token = auth_token.removeprefix("Bearer ").strip()
        headers["Authorization"] = f"Bearer {token}"
        logger.info("Gateway MCP client: Bearer JWT auth configured")

    # Custom headers for context propagation to targets
    if session_id:
        headers["x-session-id"] = session_id
    if user_id:
        headers["x-user-id"] = user_id
    logger.debug(f"Gateway MCP client: custom headers x-session-id={session_id}, x-user-id={user_id}")

    captured_url = gateway_url
    captured_headers = dict(headers)

    def client_factory():
        http_client = httpx.AsyncClient(
            headers=captured_headers,
            timeout=httpx.Timeout(30, read=300),
        )
        return streamable_http_client(
            captured_url,
            http_client=http_client,
        )

    if allowed_tools:
        # Preemptive search provided top-k tools; use allow-list mode
        mcp_client = FilteredMCPClient(
            client_factory,
            excluded_tools=EXCLUDED_TOOLS,
            allowed_tools=set(allowed_tools),
        )
        logger.info(f"Gateway MCP client created: {gateway_url} (allow-list: {allowed_tools})")
    else:
        excluded = [] if use_search else EXCLUDED_TOOLS
        mcp_client = FilteredMCPClient(
            client_factory,
            excluded_tools=excluded,
        )
        logger.info(f"Gateway MCP client created: {gateway_url} (search={'enabled' if use_search else 'filtered'})")

    return mcp_client
