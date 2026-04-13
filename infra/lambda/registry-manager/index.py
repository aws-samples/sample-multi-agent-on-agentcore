"""Custom Resource Lambda for AgentCore Registry management.

Handles Registry and RegistryRecord lifecycle (Create/Update/Delete) via
the bedrock-agentcore-control boto3 API, since CloudFormation does not yet
have native resource types for Registry.

Expects ResourceProperties:
  For Registry:
    Action: "MANAGE_REGISTRY"
    RegistryName: str
    RegistryDescription: str (optional)
    AutoApproval: "true" | "false" (optional, default "false")

  For RegistryRecord:
    Action: "MANAGE_RECORD"
    RegistryId: str
    RecordName: str
    RecordDescription: str
    RecordVersion: str
    DescriptorType: "MCP" | "A2A" | ...
    Descriptors: JSON string of descriptors object
"""

import json
import logging
import time
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

import os
logger.info(f"AWS_REGION={os.environ.get('AWS_REGION')}, AWS_DEFAULT_REGION={os.environ.get('AWS_DEFAULT_REGION')}")
client = boto3.client("bedrock-agentcore-control", region_name=os.environ.get("AWS_REGION", "us-west-2"))


def send_response(event, status, data=None, reason=""):
    """Send response to CloudFormation."""
    body = json.dumps({
        "Status": status,
        "Reason": reason or "See CloudWatch logs",
        "PhysicalResourceId": data.get("PhysicalResourceId", event.get("PhysicalResourceId", event["RequestId"])) if data else event.get("PhysicalResourceId", event["RequestId"]),
        "StackId": event["StackId"],
        "RequestId": event["RequestId"],
        "LogicalResourceId": event["LogicalResourceId"],
        "Data": data or {},
    }).encode()

    req = urllib.request.Request(
        event["ResponseURL"],
        data=body,
        method="PUT",
        headers={"Content-Type": ""},
    )
    urllib.request.urlopen(req)


def wait_for_registry_ready(registry_id, max_wait=120):
    """Poll until registry status is READY."""
    start = time.time()
    while time.time() - start < max_wait:
        resp = client.get_registry(registryId=registry_id)
        status = resp.get("status", "")
        if status == "READY":
            return True
        if "FAILED" in status:
            raise Exception(f"Registry entered {status} state")
        logger.info(f"Registry {registry_id} status: {status}, waiting...")
        time.sleep(5)
    raise Exception(f"Registry {registry_id} did not become READY within {max_wait}s")


def handle_registry(event, props):
    """Manage Registry lifecycle."""
    request_type = event["RequestType"]
    name = props["RegistryName"]
    description = props.get("RegistryDescription", "")
    auto_approval = props.get("AutoApproval", "false").lower() == "true"

    if request_type == "Create":
        resp = client.create_registry(
            name=name,
            description=description,
            approvalConfiguration={"autoApproval": auto_approval},
        )
        registry_arn = resp["registryArn"]
        # create_registry only returns ARN; extract ID from it
        registry_id = registry_arn.split("/")[-1]
        logger.info(f"Created registry: {registry_id} (arn={registry_arn})")

        wait_for_registry_ready(registry_id)

        return {
            "PhysicalResourceId": registry_id,
            "RegistryId": registry_id,
            "RegistryArn": registry_arn,
        }

    elif request_type == "Update":
        registry_id = event["PhysicalResourceId"]
        client.update_registry(
            registryId=registry_id,
            description=description,
            approvalConfiguration={"autoApproval": auto_approval},
        )
        wait_for_registry_ready(registry_id)
        resp = client.get_registry(registryId=registry_id)
        return {
            "PhysicalResourceId": registry_id,
            "RegistryId": registry_id,
            "RegistryArn": resp.get("registryArn", ""),
        }

    elif request_type == "Delete":
        registry_id = event["PhysicalResourceId"]
        try:
            # Delete all records first
            records = client.list_registry_records(registryId=registry_id).get("registryRecords", [])
            for r in records:
                try:
                    rec_id = r.get("recordId") or r.get("recordArn", "").split("/")[-1]
                    client.delete_registry_record(registryId=registry_id, recordId=rec_id)
                    logger.info(f"Deleted record: {rec_id}")
                except Exception as e:
                    logger.warning(f"Failed to delete record: {e}")

            client.delete_registry(registryId=registry_id)
            logger.info(f"Deleted registry: {registry_id}")
        except client.exceptions.ResourceNotFoundException:
            logger.info(f"Registry {registry_id} already deleted")
        except Exception as e:
            logger.warning(f"Error deleting registry {registry_id}: {e}")
        return {"PhysicalResourceId": registry_id}


def handle_record(event, props):
    """Manage RegistryRecord lifecycle."""
    request_type = event["RequestType"]
    registry_id = props["RegistryId"]
    name = props["RecordName"]
    description = props.get("RecordDescription", "")
    record_version = props.get("RecordVersion", "1.0.0")
    descriptor_type = props.get("DescriptorType", "MCP")

    # Build MCP descriptors from simple CDK properties
    # (avoids double-serialization issues with nested JSON in CloudFormation)
    server_name = props.get("ServerName", name)
    server_description = props.get("ServerDescription", description)
    display_name = props.get("DisplayName", name)
    tool_name = props.get("ToolName", "")
    tool_description = props.get("ToolDescription", "")
    tool_input_schema = props.get("ToolInputSchema", "")

    # MCP server schema v2025-12-11 limits description to 100 chars
    mcp_server_schema = json.dumps({
        "name": server_name,
        "description": server_description[:100],
        "version": record_version,
        "title": display_name,
        "packages": [
            {
                "registryType": "npm",
                "identifier": f"@agentcore/{name}",
                "version": record_version,
                "registryBaseUrl": "https://registry.npmjs.org",
                "runtimeHint": "npx",
                "transport": {"type": "stdio"},
            }
        ],
    })

    if tool_input_schema:
        input_schema = json.loads(tool_input_schema)
    else:
        input_schema = {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "Natural language query"}},
            "required": ["query"],
        }

    mcp_tool_schema = json.dumps({
        "tools": [
            {
                "name": tool_name or name,
                "description": tool_description or description,
                "inputSchema": input_schema,
            }
        ]
    })

    descriptors = {
        "mcp": {
            "server": {
                "schemaVersion": "2025-12-11",
                "inlineContent": mcp_server_schema,
            },
            "tools": {
                "inlineContent": mcp_tool_schema,
            },
        }
    }
    logger.info(f"Descriptors payload: {json.dumps(descriptors, indent=2)}")

    if request_type == "Create":
        resp = client.create_registry_record(
            registryId=registry_id,
            name=name,
            description=description,
            recordVersion=record_version,
            descriptorType=descriptor_type,
            descriptors=descriptors,
        )
        # API returns recordArn, not recordId — extract ID from ARN
        record_arn = resp.get("recordArn", "")
        record_id = record_arn.split("/")[-1] if record_arn else resp.get("recordId", "")
        logger.info(f"Created record: {record_id} ({name}, arn={record_arn})")

        # Wait for record to leave CREATING state, then submit for approval
        for _ in range(12):
            try:
                rec = client.get_registry_record(registryId=registry_id, recordId=record_id)
                rec_status = rec.get("status", "")
                if rec_status != "CREATING":
                    break
            except Exception:
                pass
            time.sleep(5)

        try:
            client.submit_registry_record_for_approval(
                registryId=registry_id,
                recordId=record_id,
            )
            logger.info(f"Submitted record {record_id} for approval")
        except Exception as e:
            logger.warning(f"Submit for approval failed: {e}")

        return {
            "PhysicalResourceId": record_id,
            "RecordId": record_id,
        }

    elif request_type == "Update":
        record_id = event["PhysicalResourceId"]
        client.update_registry_record(
            registryId=registry_id,
            recordId=record_id,
            description={"optionalValue": description},
            recordVersion=record_version,
            descriptors={"optionalValue": {
                "mcp": {"optionalValue": {
                    "server": {"optionalValue": descriptors["mcp"]["server"]},
                    "tools": {"optionalValue": descriptors["mcp"]["tools"]},
                }},
            }},
        )
        logger.info(f"Updated record: {record_id}")
        return {
            "PhysicalResourceId": record_id,
            "RecordId": record_id,
        }

    elif request_type == "Delete":
        record_id = event["PhysicalResourceId"]
        try:
            client.delete_registry_record(registryId=registry_id, recordId=record_id)
            logger.info(f"Deleted record: {record_id}")
        except client.exceptions.ResourceNotFoundException:
            logger.info(f"Record {record_id} already deleted")
        except Exception as e:
            logger.warning(f"Error deleting record {record_id}: {e}")
        return {"PhysicalResourceId": record_id}


def lambda_handler(event, context):
    """CloudFormation Custom Resource handler."""
    logger.info(f"Event: RequestType={event['RequestType']}, Action={event.get('ResourceProperties', {}).get('Action', 'unknown')}")

    try:
        props = event.get("ResourceProperties", {})
        action = props.get("Action", "")

        if action == "MANAGE_REGISTRY":
            data = handle_registry(event, props)
        elif action == "MANAGE_RECORD":
            data = handle_record(event, props)
        else:
            raise ValueError(f"Unknown action: {action}")

        send_response(event, "SUCCESS", data)

    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        send_response(event, "FAILED", reason=str(e))
