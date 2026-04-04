"""Concierge Agent - Routes queries to specialist sub-agents via Gateway.

Uses Strands Agent with BedrockModel, Gateway MCP tools, and AgentCore Memory.
Includes active memory retrieval tool for long-term user context.
"""

import json
import logging
import os
from typing import Optional

import boto3
from strands import Agent, tool
from strands.models.bedrock import BedrockModel

from gateway.mcp_client import create_gateway_mcp_client
from session.session_manager import create_session_manager

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Concierge Agent — an enterprise AI assistant that helps employees with HR, IT, Finance, Productivity, and Company Knowledge queries.

You have access to five specialist agent tools:

- **hr_agent**: Human Resources queries — employee profiles, PTO balances and requests, performance reviews, open positions, onboarding checklists.

- **it_support_agent**: IT Support queries — support tickets, software access, equipment requests, service status checks.

- **finance_agent**: Finance queries — expense reports and submissions, department budgets, invoice status, reimbursement tracking.

- **productivity_agent**: Productivity queries — calendar management, document search, meeting notes, task tracking.

- **knowledge_agent**: Company Knowledge — HR policies, employee handbook, office locations and amenities, org information.

<tool_usage>
- Route each query to the most appropriate agent; call multiple agents if the query spans domains
- Pass a clear, specific natural language query to each agent
- Only use agents that are explicitly available — do not fabricate tool calls
- If no agent can address the request, clearly inform the user
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


def create_orchestrator_agent(
    session_id: str,
    user_id: str,
    model_id: Optional[str] = None,
    auth_token: Optional[str] = None,
    use_search: bool = False,
    allowed_tools: Optional[list] = None,
    use_memory_retrieval: bool = False,
) -> Agent:
    """Create a Concierge Agent with Gateway MCP tools and session management.

    Args:
        session_id: Session identifier for conversation continuity
        user_id: User identifier for personalization
        model_id: Bedrock model ID (default from env)
        auth_token: User JWT for Gateway CUSTOM_JWT authentication
        use_search: Whether semantic search pre-filtering is active
        allowed_tools: Tool allow-list from preemptive search
        use_memory_retrieval: Whether to include the memory retrieval tool

    Returns:
        Configured Strands Agent instance
    """
    if not model_id:
        model_id = os.environ.get(
            "MODEL_ID", "us.anthropic.claude-sonnet-4-6"
        )

    model = BedrockModel(
        model_id=model_id,
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
    )

    session_manager = create_session_manager(
        session_id=session_id,
        user_id=user_id,
    )

    tools = [create_memory_retrieval_tool(user_id)] if use_memory_retrieval else []

    gateway_client = create_gateway_mcp_client(
        auth_token=auth_token,
        session_id=session_id,
        user_id=user_id,
        use_search=use_search,
        allowed_tools=allowed_tools,
    )
    if gateway_client:
        tools.append(gateway_client)

    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
        session_manager=session_manager,
        callback_handler=None,
    )

    logger.info(
        f"Concierge agent created: session={session_id}, user={user_id}, "
        f"model={model_id}, gateway={'enabled' if gateway_client else 'disabled'}, "
        f"memory_retrieval={'enabled' if use_memory_retrieval else 'disabled'}"
    )

    return agent
