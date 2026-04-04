"""DynamoDB client with RBAC support via scoped credentials.

Provides helper functions for querying the per-user table (with scoped
credentials from the interceptor) and the global reference table (with
default runtime credentials).

Environment variables:
- USER_DATA_TABLE: Per-user DynamoDB table name (RBAC-protected)
- GLOBAL_DATA_TABLE: Global reference DynamoDB table name
- AWS_REGION: AWS region for DynamoDB client
"""

import json
import logging
import os

import boto3
from boto3.dynamodb.conditions import Key

from shared.user_context import get_current_username, get_scoped_credentials

logger = logging.getLogger(__name__)

USER_DATA_TABLE = os.environ.get("USER_DATA_TABLE", "")
GLOBAL_DATA_TABLE = os.environ.get("GLOBAL_DATA_TABLE", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

# Default DynamoDB resource for global table (uses runtime execution role)
_default_dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)


def _get_scoped_dynamodb():
    """Create a DynamoDB resource using the RBAC-scoped credentials.

    The scoped credentials are injected by the interceptor Lambda and
    stored in contextvars by UserContextMiddleware. They are tagged with
    user_id, so IAM LeadingKeys condition restricts access to the user's
    partition only.
    """
    creds = get_scoped_credentials()
    if not creds:
        logger.warning("No scoped credentials available — falling back to default credentials")
        return _default_dynamodb

    return boto3.resource(
        "dynamodb",
        region_name=AWS_REGION,
        aws_access_key_id=creds["aws_access_key_id"],
        aws_secret_access_key=creds["aws_secret_access_key"],
        aws_session_token=creds["aws_session_token"],
    )


# ============================================================================
# Per-user table queries (RBAC-scoped)
# ============================================================================

def query_user_items(sk_prefix: str, username: str | None = None) -> list[dict]:
    """Query the per-user table for items matching SK prefix.

    Uses scoped credentials (RBAC) so IAM enforces that only the
    authenticated user's data is accessible.

    Args:
        sk_prefix: Sort key prefix to match (e.g., 'HR#PTO_REQUEST')
        username: Override username (defaults to current context user)

    Returns:
        List of item dicts (PK/SK stripped, nested JSON fields parsed).
    """
    user = username or get_current_username()
    if user == "unknown":
        logger.warning("query_user_items called with unknown user")
        return []

    dynamodb = _get_scoped_dynamodb()
    table = dynamodb.Table(USER_DATA_TABLE)

    response = table.query(
        KeyConditionExpression=Key("PK").eq(user) & Key("SK").begins_with(sk_prefix),
    )

    items = []
    for item in response.get("Items", []):
        cleaned = {k: v for k, v in item.items() if k not in ("PK", "SK")}
        # Parse JSON string fields back to objects
        for key, value in cleaned.items():
            if isinstance(value, str) and value.startswith(("[", "{")):
                try:
                    cleaned[key] = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    pass
        items.append(cleaned)

    logger.info(f"query_user_items: user={user}, sk_prefix={sk_prefix}, count={len(items)}")
    return items


def get_user_item(sk: str, username: str | None = None) -> dict | None:
    """Get a single item from the per-user table by exact SK.

    Args:
        sk: Exact sort key (e.g., 'HR#PROFILE', 'HR#PTO_BALANCE')
        username: Override username (defaults to current context user)

    Returns:
        Item dict (PK/SK stripped) or None if not found.
    """
    user = username or get_current_username()
    if user == "unknown":
        logger.warning("get_user_item called with unknown user")
        return None

    dynamodb = _get_scoped_dynamodb()
    table = dynamodb.Table(USER_DATA_TABLE)

    response = table.get_item(Key={"PK": user, "SK": sk})
    item = response.get("Item")
    if not item:
        return None

    cleaned = {k: v for k, v in item.items() if k not in ("PK", "SK")}
    # Parse JSON string fields back to objects
    for key, value in cleaned.items():
        if isinstance(value, str) and value.startswith(("[", "{")):
            try:
                cleaned[key] = json.loads(value)
            except (json.JSONDecodeError, ValueError):
                pass

    return cleaned


# ============================================================================
# Global table queries (no RBAC — uses default runtime credentials)
# ============================================================================

def query_global_items(pk_prefix: str) -> list[dict]:
    """Query the global reference table by PK prefix via scan + filter.

    Args:
        pk_prefix: PK prefix to match (e.g., 'POLICY', 'OFFICE', 'HANDBOOK')

    Returns:
        List of item dicts.
    """
    table = _default_dynamodb.Table(GLOBAL_DATA_TABLE)

    response = table.scan(
        FilterExpression=Key("PK").begins_with(pk_prefix),
    )

    items = []
    for item in response.get("Items", []):
        # Keep PK for identification (e.g., 'POLICY#pto_policy')
        cleaned = {k: v for k, v in item.items() if k != "SK"}
        for key, value in cleaned.items():
            if isinstance(value, str) and value.startswith(("[", "{")):
                try:
                    cleaned[key] = json.loads(value)
                except (json.JSONDecodeError, ValueError):
                    pass
        items.append(cleaned)

    logger.info(f"query_global_items: pk_prefix={pk_prefix}, count={len(items)}")
    return items


def get_global_item(pk: str, sk: str = "DETAIL") -> dict | None:
    """Get a single item from the global reference table.

    Args:
        pk: Partition key (e.g., 'POLICY#pto_policy', 'OFFICE#seattle')
        sk: Sort key (default: 'DETAIL')

    Returns:
        Item dict or None if not found.
    """
    table = _default_dynamodb.Table(GLOBAL_DATA_TABLE)

    response = table.get_item(Key={"PK": pk, "SK": sk})
    item = response.get("Item")
    if not item:
        return None

    cleaned = {k: v for k, v in item.items() if k not in ("PK", "SK")}
    for key, value in cleaned.items():
        if isinstance(value, str) and value.startswith(("[", "{")):
            try:
                cleaned[key] = json.loads(value)
            except (json.JSONDecodeError, ValueError):
                pass

    return cleaned
