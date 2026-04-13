"""Registry Client for AgentCore Registry.

Provides semantic search and catalog listing over the central agent registry.
The Registry is a control-plane / build-time service — it holds metadata about
registered agents (including tool schemas with inputSchema), but does NOT
carry runtime traffic.

Usage:
  1. list_approved_agents() — get all approved agents (for catalog / tool generation)
  2. search() — semantic search for discovery (when agent count is large)
"""

import json
import logging
import os
from typing import Optional

import boto3

logger = logging.getLogger(__name__)


class RegistryClient:
    """Client for AgentCore Registry operations."""

    def __init__(
        self,
        registry_id: Optional[str] = None,
        region: Optional[str] = None,
    ):
        self.region = region or os.environ.get("AWS_REGION", "us-west-2")
        self.registry_id = registry_id or os.environ.get("REGISTRY_ID", "")
        # Data Plane client for search
        self._data_client = boto3.client("bedrock-agentcore", region_name=self.region)
        # Control Plane client for list/get
        self._control_client = boto3.client("bedrock-agentcore-control", region_name=self.region)

        if not self.registry_id:
            logger.warning("REGISTRY_ID not configured — registry discovery disabled")

    @property
    def enabled(self) -> bool:
        return bool(self.registry_id)

    def search(self, query: str, max_results: int = 5) -> list[dict]:
        """Semantic search for agents matching a natural language query.

        Args:
            query: Natural language description of what the user needs.
            max_results: Maximum number of results to return.

        Returns:
            List of matching registry records.
        """
        if not self.registry_id:
            return []

        try:
            response = self._data_client.search_registry_records(
                registryIds=[self.registry_id],
                searchQuery=query,
                maxResults=max_results,
            )
            records = response.get("registryRecords", [])
            logger.info(
                f"Registry search for '{query[:60]}': "
                f"{len(records)} results — {[r['name'] for r in records]}"
            )
            return records

        except Exception as e:
            logger.warning(f"Registry search failed: {e}")
            return []

    def list_approved_agents(self) -> list[dict]:
        """List all APPROVED MCP agent records in the Registry.

        Returns:
            List of approved registry records (summary — no descriptors).
        """
        if not self.registry_id:
            return []

        try:
            response = self._control_client.list_registry_records(
                registryId=self.registry_id,
            )
            records = response.get("registryRecords", [])
            approved = [
                r for r in records
                if r.get("status") == "APPROVED"
                and r.get("descriptorType") == "MCP"
            ]
            logger.info(
                f"Registry catalog: {len(approved)} approved agents — "
                f"{[r['name'] for r in approved]}"
            )
            return approved

        except Exception as e:
            logger.warning(f"Registry list failed: {e}")
            return []

    def get_record(self, record_id: str) -> Optional[dict]:
        """Get full registry record including descriptors (tool schemas).

        Args:
            record_id: The registry record ID.

        Returns:
            Full record dict or None on failure.
        """
        if not self.registry_id:
            return None

        try:
            response = self._control_client.get_registry_record(
                registryId=self.registry_id,
                recordId=record_id,
            )
            return response
        except Exception as e:
            logger.warning(f"Failed to get registry record {record_id}: {e}")
            return None


# Module-level singleton
_registry_client: Optional[RegistryClient] = None


def get_registry_client() -> RegistryClient:
    """Get or create the module-level RegistryClient singleton."""
    global _registry_client
    if _registry_client is None:
        _registry_client = RegistryClient()
    return _registry_client
