"""User context propagation via JSON-RPC body injection.

The Gateway interceptor Lambda injects user identity and RBAC credentials into
the JSON-RPC params.arguments:
- injected_username, injected_user_id, injected_session_id (identity)
- injected_aws_access_key_id, injected_aws_secret_access_key,
  injected_aws_session_token (scoped credentials for DynamoDB RBAC)

This ASGI middleware extracts those fields into contextvars and strips them
from the body before it reaches the MCP handler, keeping the tool schema
clean (only 'query' param visible to tools).
"""

import json
import logging
from contextvars import ContextVar

logger = logging.getLogger(__name__)

current_username: ContextVar[str] = ContextVar("current_username", default="unknown")
current_user_id: ContextVar[str] = ContextVar("current_user_id", default="unknown")
current_session_id: ContextVar[str] = ContextVar("current_session_id", default="unknown")
current_role: ContextVar[str] = ContextVar("current_role", default="unknown")

# RBAC: Scoped AWS credentials (injected by interceptor via STS AssumeRole + TagSession)
current_aws_access_key_id: ContextVar[str] = ContextVar("current_aws_access_key_id", default="")
current_aws_secret_access_key: ContextVar[str] = ContextVar("current_aws_secret_access_key", default="")
current_aws_session_token: ContextVar[str] = ContextVar("current_aws_session_token", default="")


def get_current_username() -> str:
    """Get the username (e.g. 'alice') from the current request context."""
    return current_username.get()


def get_current_user_id() -> str:
    """Get the user ID (Cognito sub UUID) from the current request context."""
    return current_user_id.get()


def get_current_session_id() -> str:
    """Get the session ID from the current request context."""
    return current_session_id.get()


def get_current_role() -> str:
    """Get the RBAC role (e.g. 'HR_Manager') from the current request context."""
    return current_role.get()


def get_scoped_credentials() -> dict | None:
    """Get the RBAC-scoped AWS credentials from the current request context.

    Returns a dict with 'aws_access_key_id', 'aws_secret_access_key',
    'aws_session_token' if available, or None if no scoped credentials
    were injected (e.g. for gateway built-in tools or when RBAC is disabled).
    """
    access_key = current_aws_access_key_id.get()
    secret_key = current_aws_secret_access_key.get()
    session_token = current_aws_session_token.get()

    if access_key and secret_key and session_token:
        return {
            "aws_access_key_id": access_key,
            "aws_secret_access_key": secret_key,
            "aws_session_token": session_token,
        }
    return None


class UserContextMiddleware:
    """ASGI middleware that extracts user identity and RBAC credentials into contextvars.

    Reads injected_username, injected_user_id, injected_session_id, and
    injected_aws_* credentials from the JSON-RPC params.arguments (injected by
    the Gateway interceptor Lambda), stores them in contextvars, and strips
    them from the body before the MCP handler sees them.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Buffer the full request body
        first_message = await receive()
        body = first_message.get("body", b"")
        more_body = first_message.get("more_body", False)

        while more_body:
            next_message = await receive()
            body += next_message.get("body", b"")
            more_body = next_message.get("more_body", False)

        # Extract injected_* fields from JSON-RPC arguments and strip them
        uname, uid, sid, user_role = "", "", "", ""
        access_key, secret_key, session_token = "", "", ""
        cleaned_body = body
        try:
            data = json.loads(body)
            params = data.get("params", {})
            arguments = params.get("arguments", {})

            if isinstance(arguments, dict):
                uname = arguments.pop("injected_username", "")
                uid = arguments.pop("injected_user_id", "")
                sid = arguments.pop("injected_session_id", "")
                user_role = arguments.pop("injected_role", "")
                arguments.pop("injected_auth_token", None)  # kept for backward compatibility

                # RBAC credentials — never log these values
                access_key = arguments.pop("injected_aws_access_key_id", "")
                secret_key = arguments.pop("injected_aws_secret_access_key", "")
                session_token = arguments.pop("injected_aws_session_token", "")

                cleaned_body = json.dumps(data).encode()

            if uname:
                logger.info(f"UserContextMiddleware: username={uname}, user_id={uid}, role={user_role}, session_id={sid}, rbac={'yes' if access_key else 'no'}")
        except (json.JSONDecodeError, AttributeError):
            pass  # Not a JSON-RPC body (e.g. MCP session follow-up)

        current_username.set(uname or "unknown")
        current_user_id.set(uid or "unknown")
        current_session_id.set(sid or "unknown")
        current_role.set(user_role or "unknown")
        current_aws_access_key_id.set(access_key)
        current_aws_secret_access_key.set(secret_key)
        current_aws_session_token.set(session_token)

        # Replay the cleaned body to the MCP handler
        body_replayed = False

        async def replay_receive():
            nonlocal body_replayed
            if not body_replayed:
                body_replayed = True
                return {
                    "type": "http.request",
                    "body": cleaned_body,
                    "more_body": False,
                }
            return await receive()

        await self.app(scope, replay_receive, send)
