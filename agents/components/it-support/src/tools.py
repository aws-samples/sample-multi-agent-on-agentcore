"""IT Support Domain Tools - Business Logic

Standalone functions for IT support operations: ticket management,
software access, equipment requests, and service status.
Per-user data is read from DynamoDB using RBAC-scoped credentials.
SERVICE_STATUS is global operational data kept as a constant.
"""

import json

from shared.dynamo_client import query_user_items

# Global service status — not per-user, not in DynamoDB
SERVICE_STATUS = {
    "email": {"service": "Email (Microsoft 365)", "status": "operational", "uptime": "99.98%"},
    "vpn": {"service": "VPN (Cisco AnyConnect)", "status": "degraded", "incident": "Intermittent connectivity issues in US-West region", "started": "2026-02-11 09:00 UTC"},
    "jira": {"service": "Jira / Confluence", "status": "operational", "uptime": "99.95%"},
    "github": {"service": "GitHub Enterprise", "status": "operational", "uptime": "99.99%"},
    "slack": {"service": "Slack", "status": "operational", "uptime": "99.97%"},
    "aws": {"service": "AWS Internal Tools", "status": "operational", "uptime": "99.99%"},
}


def get_my_tickets(username: str) -> str:
    """Retrieve all IT support tickets for the current user."""
    tickets = query_user_items("IT#TICKET", username)
    open_tickets = [t for t in tickets if t.get("status") in ("open", "in_progress", "pending_approval")]
    return json.dumps({
        "user": username,
        "tickets": tickets,
        "open_count": len(open_tickets),
        "total_count": len(tickets),
    }, indent=2)


def create_support_ticket(
    username: str,
    issue_type: str,
    description: str,
    priority: str = "medium",
) -> str:
    """Create a new IT support ticket."""
    sla_map = {
        "low": "5 business days",
        "medium": "2 business days",
        "high": "4 hours",
        "critical": "1 hour",
    }
    ticket_id = f"IT-2026-{abs(hash(description)) % 9000 + 1000}"
    return json.dumps({
        "status": "ticket_created",
        "ticket_id": ticket_id,
        "created_by": username,
        "issue_type": issue_type,
        "description": description,
        "priority": priority,
        "assigned_to": "IT Service Desk",
        "sla_target": sla_map.get(priority, "2 business days"),
        "next_steps": "A technician will contact you within the SLA window.",
        "ticket_url": f"https://helpdesk.internal/tickets/{ticket_id}",
    }, indent=2)


def request_software_access(
    username: str,
    software_name: str,
    access_level: str = "standard",
    business_justification: str = "",
) -> str:
    """Request access to a software tool or application."""
    existing = query_user_items("IT#SOFTWARE", username)
    already_has = next((s for s in existing if software_name.lower() in s.get("tool", "").lower()), None)

    if already_has:
        return json.dumps({
            "status": "already_provisioned",
            "user": username,
            "software": software_name,
            "current_access": already_has,
            "message": f"You already have access to {software_name} at '{already_has['access_level']}' level.",
        }, indent=2)

    request_id = f"SAR-2026-{abs(hash(software_name + username)) % 900 + 100}"
    return json.dumps({
        "status": "request_submitted",
        "request_id": request_id,
        "requested_by": username,
        "software": software_name,
        "access_level": access_level,
        "business_justification": business_justification or "Business need",
        "approver": "Direct Manager + IT Security",
        "estimated_provisioning": "1-3 business days after approval",
        "current_software": existing,
    }, indent=2)


def request_equipment(
    username: str,
    equipment_type: str,
    description: str,
    business_justification: str = "",
) -> str:
    """Request new hardware or equipment."""
    current = query_user_items("IT#EQUIPMENT", username)
    request_id = f"EQR-2026-{abs(hash(equipment_type + username)) % 900 + 100}"
    return json.dumps({
        "status": "request_submitted",
        "request_id": request_id,
        "requested_by": username,
        "equipment_type": equipment_type,
        "description": description,
        "business_justification": business_justification or "Business need",
        "approver": "Direct Manager + IT Procurement",
        "estimated_fulfillment": "5-10 business days",
        "current_equipment": current,
    }, indent=2)


def get_my_equipment(username: str) -> str:
    """Retrieve the current user's assigned equipment inventory."""
    equipment = query_user_items("IT#EQUIPMENT", username)
    return json.dumps({
        "user": username,
        "equipment": equipment,
        "total_items": len(equipment),
    }, indent=2)


def check_service_status(service_name: str = "") -> str:
    """Check the current status of IT services and systems."""
    if service_name:
        # Try fuzzy match
        match = None
        for k, v in SERVICE_STATUS.items():
            if service_name.lower() in v["service"].lower() or service_name.lower() in k:
                match = v
                break
        if match:
            return json.dumps({"service_status": match}, indent=2)
        return json.dumps({
            "message": f"Service '{service_name}' not found. Available services below.",
            "all_services": list(SERVICE_STATUS.values()),
        }, indent=2)

    degraded = [s for s in SERVICE_STATUS.values() if s["status"] != "operational"]
    return json.dumps({
        "overall_status": "degraded" if degraded else "all_systems_operational",
        "degraded_services": degraded,
        "all_services": list(SERVICE_STATUS.values()),
    }, indent=2)


def get_my_software_access(username: str) -> str:
    """Retrieve the list of software tools and applications the current user has access to."""
    software = query_user_items("IT#SOFTWARE", username)
    return json.dumps({
        "user": username,
        "software_access": software,
        "total_tools": len(software),
    }, indent=2)
