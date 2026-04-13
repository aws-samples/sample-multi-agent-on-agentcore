"""Concierge Agent - Routes queries to specialist sub-agents via Gateway.

Uses a meta-tool pattern with AgentCore Registry and Gateway:
  - Registry (control plane): Discovers what agents exist and their tool schemas
  - Gateway (data plane): Invokes agents with auth/RBAC handling

At startup, the agent catalog is fetched from Registry. For each registered
agent, a dedicated tool function is dynamically generated from the Registry's
inputSchema — so each agent gets its own typed parameters (not a generic
"query" string). This means adding a new agent with custom parameters to
the Registry automatically creates the corresponding tool without code changes.

When agent count >= SEARCH_THRESHOLD, a search_agents tool is added for
semantic discovery.

Includes active memory retrieval tool for long-term user context.
"""

import asyncio
import json
import logging
import os
from typing import Any, Optional

import boto3
import httpx
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

from gateway.mcp_client import get_gateway_url
from gateway.registry_client import get_registry_client
from session.session_manager import create_session_manager

logger = logging.getLogger(__name__)

# When agent count >= this threshold, search_agents tool is added
SEARCH_THRESHOLD = int(os.environ.get("SEARCH_THRESHOLD", "10"))


# ============================================================
# Gateway invocation (shared by all generated tools)
# ============================================================

async def _call_gateway_tool(gateway_url: str, headers: dict, tool_name: str, arguments: dict) -> str:
    """Open a temporary MCP session to Gateway and call a specific tool."""
    try:
        http_client = httpx.AsyncClient(
            headers=headers,
            timeout=httpx.Timeout(30, read=300),
        )
        async with streamable_http_client(gateway_url, http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments)

                parts = []
                for item in result.content:
                    if hasattr(item, "text"):
                        parts.append(item.text)
                return "\n".join(parts) if parts else "Agent returned no content."

    except Exception as e:
        logger.error(f"Gateway call failed for {tool_name}: {e}", exc_info=True)
        return f"Error invoking {tool_name}: {str(e)}"


def _invoke_sync(gateway_url: str, headers: dict, tool_name: str, arguments: dict) -> str:
    """Synchronous wrapper for _call_gateway_tool."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, _call_gateway_tool(gateway_url, headers, tool_name, arguments))
                return future.result()
        else:
            return loop.run_until_complete(_call_gateway_tool(gateway_url, headers, tool_name, arguments))
    except RuntimeError:
        return asyncio.run(_call_gateway_tool(gateway_url, headers, tool_name, arguments))


# ============================================================
# Dynamic tool factory from Registry schemas
# ============================================================

# Python type mapping from JSON Schema types
_JSON_TYPE_MAP = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "array": list,
    "object": dict,
}


def _build_gateway_headers(auth_token: Optional[str], session_id: Optional[str], user_id: Optional[str]) -> dict:
    """Build headers for Gateway MCP calls.

    The user's access token (with agentcore/invoke scope) is forwarded
    directly to Gateway for both authentication and identity propagation.
    """
    headers = {}
    if auth_token:
        token = auth_token.removeprefix("Bearer ").strip()
        headers["Authorization"] = f"Bearer {token}"
    if session_id:
        headers["x-session-id"] = session_id
    if user_id:
        headers["x-user-id"] = user_id
    return headers


def create_agent_tool_from_schema(
    tool_name: str,
    description: str,
    input_schema: dict,
    gateway_url: str,
    auth_token: Optional[str] = None,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
    gateway_tool_name: Optional[str] = None,
):
    """Dynamically create a Strands tool from a Registry inputSchema.

    Generates a Python function whose signature matches the schema's properties,
    then applies @tool to it. The LLM sees typed parameters (not a generic dict).

    Args:
        tool_name: MCP tool name (e.g. 'hr_agent')
        description: Tool description for LLM
        input_schema: JSON Schema from Registry record's tool descriptor
        gateway_url: Gateway URL for invocation
        auth_token: JWT for Gateway auth
        session_id: Session ID for context propagation
        user_id: User ID for context propagation

    Returns:
        Strands-compatible tool function
    """
    properties = input_schema.get("properties", {})
    required = set(input_schema.get("required", []))
    headers = _build_gateway_headers(auth_token, session_id, user_id)
    # Use Gateway-prefixed name for actual MCP call, local name for LLM
    gw_tool_name = gateway_tool_name or tool_name

    # Build parameter info for dynamic function creation
    params = []
    param_names = []
    for prop_name, prop_schema in properties.items():
        param_names.append(prop_name)
        py_type = _JSON_TYPE_MAP.get(prop_schema.get("type", "string"), str)
        is_required = prop_name in required
        params.append({
            "name": prop_name,
            "type": py_type,
            "required": is_required,
            "description": prop_schema.get("description", ""),
            "default": prop_schema.get("default"),
        })

    # Build docstring from parameter descriptions
    doc_lines = [description, "", "Args:"]
    for p in params:
        opt = "" if p["required"] else " (optional)"
        doc_lines.append(f"    {p['name']}: {p['description']}{opt}")
    docstring = "\n".join(doc_lines)

    # Create the tool implementation function dynamically
    # We use exec to generate a function with the correct signature
    # so that Strands @tool introspects proper parameter types.

    # Build function signature parts
    sig_parts = []
    for p in params:
        type_name = p["type"].__name__
        if p["required"]:
            sig_parts.append(f"{p['name']}: {type_name}")
        else:
            default = repr(p["default"]) if p["default"] is not None else _get_type_default(p["type"])
            sig_parts.append(f"{p['name']}: {type_name} = {default}")

    sig_str = ", ".join(sig_parts)

    # Build argument dict construction
    args_lines = []
    for p in params:
        if p["required"]:
            args_lines.append(f'    args["{p["name"]}"] = {p["name"]}')
        else:
            args_lines.append(f'    if {p["name"]} is not None and {p["name"]} != {_get_type_default(p["type"])}:')
            args_lines.append(f'        args["{p["name"]}"] = {p["name"]}')
    args_block = "\n".join(args_lines) if args_lines else "    pass"

    func_code = f'''
def {tool_name}({sig_str}) -> str:
    """{docstring}"""
    args = {{}}
{args_block}
    return _invoke_fn(_gw_url, _headers, _gw_tool_name, args)
'''

    # Execute in a namespace with required bindings
    namespace = {
        "_invoke_fn": _invoke_sync,
        "_gw_url": gateway_url,
        "_headers": headers,
        "_gw_tool_name": gw_tool_name,
    }
    exec(func_code, namespace)

    tool_func = namespace[tool_name]
    # Apply Strands @tool decorator
    return tool(tool_func)


def _get_type_default(py_type: type) -> str:
    """Get a safe default value repr for a given Python type."""
    if py_type == str:
        return '""'
    elif py_type == int:
        return "0"
    elif py_type == float:
        return "0.0"
    elif py_type == bool:
        return "False"
    elif py_type == list:
        return "[]"
    elif py_type == dict:
        return "{}"
    return "None"


# ============================================================
# Load catalog and generate tools from Registry
# ============================================================

# Cache: loaded once per process
_catalog_cache: Optional[dict] = None


def _load_catalog() -> dict:
    """Load agent catalog from Registry with full tool schemas.

    Returns dict with:
        'agents': list of registry records
        'tools_schemas': dict mapping tool_name -> {description, inputSchema}
        'text': formatted catalog for system prompt
    """
    global _catalog_cache
    if _catalog_cache is not None:
        return _catalog_cache

    registry = get_registry_client()
    if not registry.enabled:
        logger.info("Registry not configured, using empty catalog")
        _catalog_cache = {"agents": [], "tool_schemas": {}, "text": ""}
        return _catalog_cache

    agents = registry.list_approved_agents()
    if not agents:
        logger.warning("Registry returned no approved agents")
        _catalog_cache = {"agents": [], "tool_schemas": {}, "text": ""}
        return _catalog_cache

    # For each agent, get full record to extract tool schemas
    tool_schemas = {}
    # Maps local tool name -> Gateway-prefixed tool name (target___tool)
    gateway_tool_names = {}
    prompt_lines = ["You have access to the following specialist agents (discovered from AgentCore Registry):\n"]

    for agent_record in agents:
        record_id = agent_record.get("recordId", "")
        name = agent_record.get("name", "unknown")
        description = agent_record.get("description", "No description")

        # Try to get full record with descriptors
        record_info = _get_tool_schema_from_record(registry, record_id)
        if record_info:
            server_name = record_info.get("server_name")
            for tool_def in record_info.get("tools", []):
                tool_name = tool_def["name"]
                tool_schemas[tool_name] = {
                    "description": tool_def.get("description", description),
                    "inputSchema": tool_def.get("inputSchema", {"type": "object", "properties": {"query": {"type": "string", "description": "Natural language query"}}, "required": ["query"]}),
                }
                # Gateway prefixes tool names with target name: target___tool
                if server_name:
                    gateway_tool_names[tool_name] = f"{server_name}___{tool_name}"
                    logger.info(f"Tool mapping: {tool_name} -> {gateway_tool_names[tool_name]}")
                # Build prompt entry with parameter info
                params_desc = _format_params_for_prompt(tool_def.get("inputSchema", {}))
                prompt_lines.append(f"- **{tool_name}**: {tool_def.get('description', description)}")
                if params_desc:
                    prompt_lines.append(f"  Parameters: {params_desc}")
        else:
            # Fallback: assume simple query interface
            t_name = name.replace("-", "_")
            tool_schemas[t_name] = {
                "description": description,
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "Natural language query to the agent"}},
                    "required": ["query"],
                },
            }
            prompt_lines.append(f"- **{t_name}**: {description}")
            prompt_lines.append(f"  Parameters: query (string, required)")

    _catalog_cache = {
        "agents": agents,
        "tool_schemas": tool_schemas,
        "gateway_tool_names": gateway_tool_names,
        "text": "\n".join(prompt_lines),
    }
    logger.info(f"Registry catalog loaded: {len(agents)} agents, {len(tool_schemas)} tools, gateway mappings: {gateway_tool_names}")
    return _catalog_cache


def _get_tool_schema_from_record(registry, record_id: str) -> Optional[dict]:
    """Fetch full registry record and extract tool definitions and server name.

    Returns dict with 'tools' (list of tool defs) and 'server_name' (Gateway target name).
    """
    response = registry.get_record(record_id)
    if not response:
        return None
    try:
        descriptors = response.get("descriptors", {})
        mcp = descriptors.get("mcp", {})

        # Extract Gateway target name from server descriptor
        server_name = None
        server_descriptor = mcp.get("server", {})
        server_content = server_descriptor.get("inlineContent", "")
        if server_content:
            server_parsed = json.loads(server_content)
            full_name = server_parsed.get("name", "")
            # Server name is like "project/target-name"; Gateway target is the last part
            server_name = full_name.split("/")[-1] if "/" in full_name else full_name

        tools_descriptor = mcp.get("tools", {})
        inline_content = tools_descriptor.get("inlineContent", "")
        if inline_content:
            parsed = json.loads(inline_content)
            return {"tools": parsed.get("tools", []), "server_name": server_name}
    except Exception as e:
        logger.warning(f"Failed to parse tool schema for record {record_id}: {e}")
    return None


def _format_params_for_prompt(input_schema: dict) -> str:
    """Format inputSchema properties as a brief parameter summary for system prompt."""
    properties = input_schema.get("properties", {})
    required = set(input_schema.get("required", []))
    if not properties:
        return ""
    parts = []
    for name, schema in properties.items():
        type_str = schema.get("type", "string")
        req = "required" if name in required else "optional"
        parts.append(f"{name} ({type_str}, {req})")
    return ", ".join(parts)


# ============================================================
# System prompt
# ============================================================

SYSTEM_PROMPT_TEMPLATE = """You are a Concierge Agent — an enterprise AI assistant that helps employees across multiple domains.

{agent_catalog_section}

<tool_usage>
- Call the appropriate agent tool directly with the required parameters.
{search_tool_usage}
- Call multiple agents if the query spans domains.
- Only invoke agents that exist — do not fabricate tool calls.
- If no agent can address the request, clearly inform the user.
</tool_usage>

<response_approach>
- If `retrieve_user_memory` is available, call it first for open-ended or context-dependent questions (e.g. priorities, status updates, recommendations) before routing to other agents
- Always route to the appropriate agent immediately — the agents have full access to the current user's profile and data
- Never ask the user to clarify who they are or which account/data they mean; the agents will resolve this automatically
- Synthesize agent responses into a concise, well-structured answer
- Proactively suggest next steps when relevant
- If corrected, think through the issue carefully before acknowledging
</response_approach>

<communication_style>
- Use a professional yet approachable tone
- Give concise answers to simple questions; thorough answers to complex ones
- Avoid bullet-point overload — use prose where it reads more naturally
- Do not start responses with flattery like "great question"
</communication_style>
"""


def _build_system_prompt(catalog_text: str, use_search: bool) -> str:
    search_usage = ""
    if use_search:
        search_usage = "- If unsure which agent to use, call `search_agents` first to find the right one."

    return SYSTEM_PROMPT_TEMPLATE.format(
        agent_catalog_section=catalog_text or "No agents currently registered.",
        search_tool_usage=search_usage,
    )


# ============================================================
# search_agents tool
# ============================================================

def create_search_agents_tool():
    """Create search_agents tool backed by Registry semantic search."""
    registry = get_registry_client()

    @tool
    def search_agents(query: str) -> str:
        """Search the agent registry to find specialists that can handle a query.
        Use this when you're unsure which agent to route to, or when the user's
        request doesn't clearly map to a known agent.

        Args:
            query: Natural language description of the capability needed
                   (e.g. 'expense reimbursement', 'VPN not working')
        """
        records = registry.search(query=query, max_results=5)
        if not records:
            return "No matching agents found in the registry."

        results = []
        for r in records:
            name = r.get("name", "unknown")
            tool_name = name.replace("-", "_")
            description = r.get("description", "")
            results.append({"tool_name": tool_name, "name": name, "description": description})

        return json.dumps(results, ensure_ascii=False, indent=2)

    return search_agents


# ============================================================
# Memory retrieval tool
# ============================================================

_namespace_cache: dict[str, dict[str, str]] = {}


def _resolve_namespaces(client, memory_id: str, user_id: str, suffixes: list[str]) -> dict[str, str]:
    """List memory records to discover actual namespace paths for each suffix. Cached per user."""
    cache_key = f"{memory_id}:{user_id}"
    if cache_key in _namespace_cache:
        return _namespace_cache[cache_key]
    resolved = {}
    try:
        res = client.list_memory_records(memoryId=memory_id, namespace="/", maxResults=100)
        for record in res.get("memoryRecordSummaries", []):
            for ns in (record.get("namespaces") or []):
                for suffix in suffixes:
                    if suffix not in resolved and f"/actors/{user_id}/" in ns and ns.endswith(f"/{suffix}"):
                        resolved[suffix] = ns
    except Exception as e:
        logger.warning(f"Namespace resolution failed: {e}")
    _namespace_cache[cache_key] = resolved
    return resolved


def create_memory_retrieval_tool(user_id: str):
    """Create a memory retrieval tool bound to the current user."""
    memory_id = os.environ.get("MEMORY_ID", "")
    region = os.environ.get("AWS_REGION", "us-west-2")
    client = boto3.client("bedrock-agentcore", region_name=region)

    @tool
    def retrieve_user_memory(query: str) -> str:
        """Retrieve relevant long-term memory records for the current user.
        Use this when the user asks about past interactions, preferences, or context
        from previous sessions that isn't present in the current conversation.

        Args:
            query: Topic or intent to search for (e.g. 'communication preferences',
                   'pending tasks', 'recent requests')
        """
        if not memory_id:
            return "Memory not configured."

        ns_suffixes = ["preferences", "facts"]
        ns_paths = _resolve_namespaces(client, memory_id, user_id, ns_suffixes)
        results = []

        for suffix in ns_suffixes:
            namespace = ns_paths.get(suffix)
            if not namespace:
                continue
            try:
                res = client.retrieve_memory_records(
                    memoryId=memory_id,
                    namespace=namespace,
                    searchCriteria={"searchQuery": query, "topK": 5},
                )
                for r in res.get("memoryRecordSummaries", []):
                    text = (r.get("content") or {}).get("text", "")
                    if suffix == "preferences":
                        try:
                            parsed = json.loads(text)
                            text = parsed.get("preference", text)
                        except (json.JSONDecodeError, AttributeError):
                            pass
                    if text:
                        results.append(f"[{suffix}] {text}")
            except Exception as e:
                logger.warning(f"Memory retrieval failed for namespace {namespace}: {e}")

        if not results:
            return "No relevant memory records found."
        return "\n".join(results)

    return retrieve_user_memory


# ============================================================
# Agent factory
# ============================================================

def create_orchestrator_agent(
    session_id: str,
    user_id: str,
    model_id: Optional[str] = None,
    auth_token: Optional[str] = None,
    use_memory_retrieval: bool = False,
) -> Agent:
    """Create a Concierge Agent with dynamically generated tools from Registry.

    For each registered agent, a typed tool function is created from the
    Registry's inputSchema. The tool invokes the agent through Gateway MCP.

    Args:
        session_id: Session identifier for conversation continuity
        user_id: User identifier for personalization
        model_id: Bedrock model ID (default from env)
        auth_token: User JWT for Gateway CUSTOM_JWT authentication
        use_memory_retrieval: Whether to include the memory retrieval tool

    Returns:
        Configured Strands Agent instance
    """
    if not model_id:
        model_id = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6")

    model = BedrockModel(
        model_id=model_id,
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
    )

    session_manager = create_session_manager(
        session_id=session_id,
        user_id=user_id,
    )

    # Load catalog from Registry
    catalog = _load_catalog()
    agent_count = len(catalog["agents"])
    use_search = agent_count >= SEARCH_THRESHOLD
    gateway_url = get_gateway_url()

    # Build tools list
    tools = []

    if use_memory_retrieval:
        tools.append(create_memory_retrieval_tool(user_id))

    # Generate a typed tool for each registered agent from its inputSchema
    gateway_tool_names = catalog.get("gateway_tool_names", {})
    if gateway_url:
        for t_name, t_schema in catalog["tool_schemas"].items():
            agent_tool = create_agent_tool_from_schema(
                tool_name=t_name,
                description=t_schema["description"],
                input_schema=t_schema["inputSchema"],
                gateway_url=gateway_url,
                auth_token=auth_token,
                session_id=session_id,
                user_id=user_id,
                gateway_tool_name=gateway_tool_names.get(t_name),
            )
            tools.append(agent_tool)
            logger.debug(f"Generated tool: {t_name}")
    else:
        logger.warning("Gateway URL not available — no agent tools generated")

    # Add search_agents when agent count exceeds threshold
    if use_search:
        tools.append(create_search_agents_tool())

    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=_build_system_prompt(catalog["text"], use_search),
        session_manager=session_manager,
        callback_handler=None,
    )

    logger.info(
        f"Concierge agent created: session={session_id}, user={user_id}, "
        f"model={model_id}, agents={agent_count}, tools={len(tools)}, "
        f"search={'enabled' if use_search else 'disabled'} (threshold={SEARCH_THRESHOLD}), "
        f"memory_retrieval={'enabled' if use_memory_retrieval else 'disabled'}"
    )

    return agent
