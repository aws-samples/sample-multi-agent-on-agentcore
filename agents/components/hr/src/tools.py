"""HR Domain Tools - Business Logic

Standalone functions for HR operations: PTO management, performance reviews,
open positions, and onboarding checklists.
Per-user data is read from DynamoDB using RBAC-scoped credentials
(IAM LeadingKeys condition restricts access to the authenticated user's data).
"""

import json
import uuid
from datetime import date

from shared.dynamo_client import get_user_item, query_user_items


def get_employee_profile(username: str) -> str:
    """Retrieve the employee profile for the current user."""
    profile = get_user_item("HR#PROFILE", username)
    if not profile:
        return json.dumps({"error": "Employee profile not found"}, indent=2)
    return json.dumps({"employee": profile}, indent=2)


def get_pto_balance(username: str) -> str:
    """Retrieve PTO balance and accrual status for the current user."""
    balance = get_user_item("HR#PTO_BALANCE", username)
    requests = query_user_items("HR#PTO_REQUEST", username)
    pending = [r for r in requests if r.get("status") == "pending"]
    return json.dumps({
        "user": username,
        "pto_balance": balance or {},
        "pending_requests": pending,
    }, indent=2)


def submit_pto_request(
    username: str,
    pto_type: str,
    start_date: str,
    end_date: str,
    notes: str = "",
) -> str:
    """Submit a new PTO request for the current user."""
    balance = get_user_item("HR#PTO_BALANCE", username)

    # Calculate business days (simplified)
    try:
        start = date.fromisoformat(start_date)
        end = date.fromisoformat(end_date)
        days = max(1, (end - start).days + 1)
    except ValueError:
        days = 1

    request_id = f"PTO-2026-{abs(hash(start_date + end_date)) % 900 + 100}"
    return json.dumps({
        "status": "submitted",
        "request_id": request_id,
        "submitted_by": username,
        "type": pto_type,
        "start_date": start_date,
        "end_date": end_date,
        "days_requested": days,
        "notes": notes or "No additional notes",
        "approver": "Direct Manager",
        "estimated_approval": "1-2 business days",
        "current_balance": balance or {},
    }, indent=2)


def get_open_positions(username: str, department: str = "") -> str:
    """Retrieve open job positions, optionally filtered by department."""
    positions = query_user_items("HR#OPEN_POSITION", username)
    if department:
        positions = [p for p in positions if department.lower() in p.get("department", "").lower()]
    return json.dumps({
        "open_positions": positions,
        "total_open": len(positions),
    }, indent=2)


def get_onboarding_checklist(username: str) -> str:
    """Retrieve the onboarding checklist for the current user."""
    checklist = query_user_items("HR#ONBOARDING", username)
    completed = sum(1 for t in checklist if t.get("status") == "completed")
    return json.dumps({
        "user": username,
        "checklist": checklist,
        "progress": f"{completed}/{len(checklist)} completed",
    }, indent=2)


def get_performance_review(username: str) -> str:
    """Retrieve the current performance review status and details."""
    review = get_user_item("HR#PERFORMANCE_REVIEW", username)
    return json.dumps({
        "user": username,
        "performance_review": review or {},
    }, indent=2)


def submit_performance_review(
    username: str,
    self_rating: str,
    highlights: str,
    development_goals: str,
) -> str:
    """Submit self-assessment for the current performance review cycle."""
    review = get_user_item("HR#PERFORMANCE_REVIEW", username)
    return json.dumps({
        "status": "submitted",
        "submitted_by": username,
        "cycle": review.get("cycle", "FY2026-H1") if review else "FY2026-H1",
        "self_rating": self_rating,
        "highlights": highlights,
        "development_goals": development_goals,
        "next_steps": "Manager review will be completed within 2 weeks",
        "next_deadline": review.get("next_deadline", "") if review else "",
    }, indent=2)
