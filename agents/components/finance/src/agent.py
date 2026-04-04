"""Finance Agent - Strands Agent with finance domain tools."""

import logging
import os

from strands import Agent, tool
from strands.models.bedrock import BedrockModel

import tools as finance_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Finance specialist agent for an enterprise organization.

You help employees with finance-related queries including:
- Expense report submissions and status tracking
- Department budget summaries and utilization
- Invoice status and vendor payments
- Reimbursement tracking and timelines

Use your tools to handle finance requests efficiently and accurately.
"""


def create_agent(user_id: str = None) -> Agent:
    """Create a Finance specialist Strands Agent."""
    username = user_id or "unknown"

    @tool
    def get_expense_reports() -> str:
        """Retrieve all expense reports for the current user including approved, pending, and draft expenses with amounts and categories."""
        return finance_tools.get_expense_reports(username)

    @tool
    def submit_expense(
        description: str,
        amount: str,
        category: str = "General",
        date: str = "",
        receipt_attached: bool = True,
    ) -> str:
        """Submit an expense for reimbursement.

        Args:
            description: Description of the expense
            amount: Expense amount (e.g., '$125.00')
            category: Expense category ('Travel', 'Business Meals', 'Software', 'Professional Development', 'Office Supplies', 'General')
            date: Date of expense in YYYY-MM-DD format
            receipt_attached: Whether a receipt is attached
        """
        return finance_tools.submit_expense(username, description, amount, category, date, receipt_attached)

    @tool
    def get_budget_summary() -> str:
        """Retrieve the current department budget summary including total budget, year-to-date spending, remaining budget, and breakdown by category."""
        return finance_tools.get_budget_summary(username)

    @tool
    def get_invoice_status(invoice_id: str = "") -> str:
        """Retrieve invoice status for the current user's department, optionally filtered by invoice ID.

        Args:
            invoice_id: Optional invoice ID to look up a specific invoice
        """
        return finance_tools.get_invoice_status(username, invoice_id)

    @tool
    def get_reimbursement_status() -> str:
        """Check the reimbursement status of submitted expense reports — which are pending approval and which are approved but awaiting payment."""
        return finance_tools.get_reimbursement_status(username)

    model = BedrockModel(
        model_id=os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-6"),
        region_name=os.environ.get("AWS_REGION", "us-west-2"),
    )
    system_prompt = SYSTEM_PROMPT
    if user_id:
        system_prompt += f"\n\nCurrent user: {user_id}"
    return Agent(
        model=model,
        tools=[
            get_expense_reports,
            submit_expense,
            get_budget_summary,
            get_invoice_status,
            get_reimbursement_status,
        ],
        system_prompt=system_prompt,
        name="Finance Agent",
        description="Finance specialist agent for expense reports, budgets, invoices, and reimbursements.",
    )


def process_query(query: str, user_id: str = None) -> str:
    """Process a Finance query using the agent."""
    logger.info(f"Processing Finance query (user={user_id}): {query[:100]}")
    agent = create_agent(user_id=user_id)
    result = agent(query)
    return str(result)
