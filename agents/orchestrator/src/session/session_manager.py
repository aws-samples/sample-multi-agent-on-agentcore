"""Session Manager — AgentCore Memory integration.

Uses AgentCoreMemorySessionManager for conversation history and user preferences.
"""

import logging
import os
from typing import Any

from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)

logger = logging.getLogger(__name__)


def create_session_manager(
    session_id: str,
    user_id: str,
) -> Any:
    """Create AgentCore Memory session manager.

    Args:
        session_id: Session identifier
        user_id: User/actor identifier

    Returns:
        AgentCoreMemorySessionManager instance
    """
    memory_id = os.environ.get("MEMORY_ID")
    aws_region = os.environ.get("AWS_REGION", "us-west-2")

    if not memory_id:
        raise ValueError(
            "MEMORY_ID environment variable is required. "
            "Set it to the AgentCore Memory ID."
        )

    logger.info(
        f"AgentCoreMemorySessionManager: "
        f"memory_id={memory_id}, session={session_id}, actor={user_id}"
    )

    config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=user_id,
    )

    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=aws_region,
    )
