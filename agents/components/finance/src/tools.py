"""Finance Domain Tools - Business Logic

Standalone functions for finance operations: expense management,
budget tracking, and invoice status.
Per-user data is read from DynamoDB using RBAC-scoped credentials.
"""

import json

from shared.dynamo_client import get_user_item, query_user_items


def get_expense_reports(username: str) -> str:
    """Retrieve expense reports for the current user."""
    expenses = query_user_items("FIN#EXPENSE", username)
    pending = [e for e in expenses if e.get("status") == "pending_approval"]
    total = sum(
        float(e["amount"].replace("$", "").replace(",", ""))
        for e in expenses if e.get("status") == "approved"
    )
    return json.dumps({
        "user": username,
        "expense_reports": expenses,
        "pending_count": len(pending),
        "approved_total_ytd": f"${total:,.2f}",
    }, indent=2)


def submit_expense(
    username: str,
    description: str,
    amount: str,
    category: str = "General",
    date: str = "",
    receipt_attached: bool = True,
) -> str:
    """Submit an expense report for reimbursement."""
    expense_id = f"EXP-2026-{abs(hash(description + username)) % 9000 + 1000}"
    return json.dumps({
        "status": "submitted",
        "expense_id": expense_id,
        "submitted_by": username,
        "description": description,
        "amount": amount,
        "category": category,
        "date": date or "today",
        "receipt_attached": receipt_attached,
        "approver": "Direct Manager",
        "estimated_reimbursement": "5-7 business days after approval",
        "submission_notes": "Receipt required for amounts over $25",
    }, indent=2)


def get_budget_summary(username: str) -> str:
    """Retrieve the department budget summary for the current user."""
    budget = get_user_item("FIN#BUDGET", username)
    return json.dumps({
        "user": username,
        "budget_summary": budget or {},
    }, indent=2)


def get_invoice_status(username: str, invoice_id: str = "") -> str:
    """Retrieve invoices for the current user's department, optionally filtering by invoice ID."""
    invoices = query_user_items("FIN#INVOICE", username)
    if invoice_id:
        matched = [i for i in invoices if invoice_id.lower() in i.get("invoice_id", "").lower()]
        if matched:
            return json.dumps({"invoice": matched[0]}, indent=2)
        return json.dumps({"message": f"Invoice '{invoice_id}' not found.", "all_invoices": invoices}, indent=2)
    pending = [i for i in invoices if i.get("status") in ("pending", "approved")]
    return json.dumps({
        "user": username,
        "invoices": invoices,
        "pending_count": len(pending),
    }, indent=2)


def get_reimbursement_status(username: str) -> str:
    """Check the reimbursement status of submitted expense reports."""
    expenses = query_user_items("FIN#EXPENSE", username)
    pending = [e for e in expenses if e.get("status") == "pending_approval"]
    approved_pending_payment = [e for e in expenses if e.get("status") == "approved" and "reimbursement_date" not in e]
    return json.dumps({
        "user": username,
        "pending_approval": pending,
        "approved_pending_payment": approved_pending_payment,
        "total_pending_reimbursement": f"${sum(float(e['amount'].replace('$','').replace(',','')) for e in pending + approved_pending_payment):,.2f}",
    }, indent=2)
