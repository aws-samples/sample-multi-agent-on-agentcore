"""Gateway Interceptor Lambda.

Reads the inbound JWT from the gateway request, then:
1. Exchanges the user JWT for a workload access token via AgentCore Identity
   (provider-agnostic — works with any registered OAuth provider).
2. Extracts user identity from JWT claims (OIDC standard 'sub' claim).
3. Assumes a scoped IAM role with user_id session tag for DynamoDB RBAC.
4. Injects identity + scoped credentials into the JSON-RPC body.

The MCP server ASGI middleware extracts these fields into contextvars
and strips them from the body before the tool handler sees them,
keeping the tool schema clean (only 'query' param visible to tools).
"""

import base64
import json
import logging
import os

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

sts_client = boto3.client('sts')
agentcore_client = boto3.client('bedrock-agentcore')

SCOPED_ROLE_ARN = os.environ.get('SCOPED_ROLE_ARN', '')
WORKLOAD_IDENTITY_NAME = os.environ.get('WORKLOAD_IDENTITY_NAME', '')


def decode_jwt_payload(token: str) -> dict:
    """Decode JWT payload without signature verification.

    SECURITY NOTE: The JWT signature was already verified by the AgentCore
    Gateway CUSTOM_JWT authorizer before this Lambda is invoked. This function
    only extracts claims from the validated token for user context injection.
    """
    try:
        # Remove "Bearer " prefix if present
        if token.lower().startswith("bearer "):
            token = token[7:]

        # JWT = header.payload.signature
        payload_b64 = token.split(".")[1]
        # Add padding if needed
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding

        payload_bytes = base64.urlsafe_b64decode(payload_b64)
        return json.loads(payload_bytes)
    except Exception as e:
        logger.error(f"Failed to decode JWT: {e}")
        return {}


def exchange_token_via_identity(user_jwt: str) -> str | None:
    """Exchange the user's JWT for a workload access token via AgentCore Identity.

    This is the provider-agnostic identity layer — AgentCore Identity normalizes
    the user JWT regardless of the OAuth provider (Cognito, Okta, Azure AD, etc.).
    The workload access token embeds the user's identity.
    """
    if not WORKLOAD_IDENTITY_NAME:
        logger.warning("WORKLOAD_IDENTITY_NAME not configured, skipping identity exchange")
        return None

    try:
        # Remove "Bearer " prefix if present
        raw_jwt = user_jwt
        if raw_jwt.lower().startswith("bearer "):
            raw_jwt = raw_jwt[7:]

        response = agentcore_client.get_workload_access_token_for_jwt(
            workloadName=WORKLOAD_IDENTITY_NAME,
            userToken=raw_jwt,
        )
        token = response.get('workloadAccessToken', '')
        logger.info(f"AgentCore Identity: workload access token obtained (length={len(token)})")
        return token
    except Exception as e:
        logger.warning(f"AgentCore Identity token exchange failed: {e}")
        return None


def assume_scoped_role(username: str) -> dict | None:
    """Assume the scoped IAM role with user_id session tag for RBAC.

    Returns temporary credentials (AccessKeyId, SecretAccessKey, SessionToken)
    that are scoped to the user's DynamoDB partition via IAM LeadingKeys condition.
    """
    if not SCOPED_ROLE_ARN:
        logger.warning("SCOPED_ROLE_ARN not configured, skipping RBAC credential injection")
        return None

    try:
        response = sts_client.assume_role(
            RoleArn=SCOPED_ROLE_ARN,
            RoleSessionName=f"{username}-session",
            DurationSeconds=900,  # 15 minutes (minimum)
            Tags=[
                {'Key': 'user_id', 'Value': username},
            ],
        )
        creds = response['Credentials']
        logger.info(f"Assumed scoped role for user={username}, expires={creds['Expiration']}")
        return {
            'AccessKeyId': creds['AccessKeyId'],
            'SecretAccessKey': creds['SecretAccessKey'],
            'SessionToken': creds['SessionToken'],
        }
    except Exception as e:
        logger.error(f"Failed to assume scoped role for user={username}: {e}")
        return None


def lambda_handler(event, context):
    # Log only method and tool name — avoid logging full event which may contain auth tokens
    mcp_body = event.get("mcp", {}).get("gatewayRequest", {}).get("body", {})
    logger.info(f"Interceptor: method={mcp_body.get('method', 'unknown')}, tool={mcp_body.get('params', {}).get('name', 'N/A')}")

    # Extract gateway request
    mcp_data = event.get("mcp", {})
    gateway_request = mcp_data.get("gatewayRequest", {})
    headers = gateway_request.get("headers", {})
    body = gateway_request.get("body", {})

    # Read JWT from Authorization header (user's access token with agentcore/invoke scope)
    auth_header = headers.get("authorization", "") or headers.get("Authorization", "")

    # Step 1: Exchange user JWT via AgentCore Identity (provider-agnostic)
    workload_access_token = exchange_token_via_identity(auth_header) if auth_header else None

    # Step 2: Decode JWT to extract user identity (OIDC standard claims)
    claims = {}
    if auth_header:
        claims = decode_jwt_payload(auth_header)
        logger.info(f"JWT claims keys: {list(claims.keys())}")

    # Extract identity — use OIDC standard 'sub' claim (provider-agnostic)
    user_id = claims.get("sub") or claims.get("client_id") or "unknown"
    # Username: try standard OIDC claims, then provider-specific fallbacks
    username = (
        claims.get("preferred_username")  # OIDC standard
        or claims.get("username")          # Cognito
        or claims.get("cognito:username")  # Cognito legacy
        or claims.get("email")             # Fallback to email
        or "unknown"
    )

    # Session ID: prefer custom header (app-level), fall back to JWT jti (token-level)
    session_id = headers.get("x-session-id", "") or claims.get("jti") or "unknown"

    logger.info(f"Identity: user_id={user_id}, username={username}, identity_exchanged={'yes' if workload_access_token else 'no'}")

    # Step 3: Assume scoped role for RBAC — credentials will be tagged with user_id
    scoped_creds = assume_scoped_role(username) if username != "unknown" else None

    out_headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    # Inject user context into JSON-RPC params.arguments
    # The MCP server middleware will extract and strip these before the tool sees them
    # Skip injection for Gateway built-in tools (e.g. semantic search) which have no
    # MCP server middleware to strip the injected fields.
    SKIP_INJECTION_PREFIXES = ("x_amz_bedrock_agentcore_",)

    if isinstance(body, dict) and body.get("method") == "tools/call":
        params = body.get("params", {})
        tool_name = params.get("name", "")
        if tool_name.startswith(SKIP_INJECTION_PREFIXES):
            logger.info(f"Skipping injection for built-in tool: {tool_name}")
        else:
            arguments = params.get("arguments", {})
            if isinstance(arguments, dict):
                arguments["injected_user_id"] = str(user_id)
                arguments["injected_username"] = str(username)
                arguments["injected_session_id"] = str(session_id)

                # Inject scoped AWS credentials for RBAC DynamoDB access
                if scoped_creds:
                    arguments["injected_aws_access_key_id"] = scoped_creds["AccessKeyId"]
                    arguments["injected_aws_secret_access_key"] = scoped_creds["SecretAccessKey"]
                    arguments["injected_aws_session_token"] = scoped_creds["SessionToken"]

                logger.info(f"Injected context for tool: {tool_name} (rbac={'yes' if scoped_creds else 'no'})")

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayRequest": {
                "headers": out_headers,
                "body": body,
            }
        },
    }
