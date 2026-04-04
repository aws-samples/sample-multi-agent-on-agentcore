"""HR Agent - Strands Agent with human resources domain tools."""

import logging
import os

from strands import Agent, tool
from strands.models.bedrock import BedrockModel

import tools as hr_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an HR specialist agent for an enterprise organization.

You help employees with human resources queries including:
- Employee profile and directory lookups
- PTO (Paid Time Off) balance checks and requests
- Performance review status and self-assessment submissions
- Open job positions and internal mobility
- Onboarding checklists and progress tracking

Use your tools to handle HR requests efficiently and accurately.
"""


def create_agent(user_id: str = None) -> Agent:
    """Create an HR specialist Strands Agent."""
    username = user_id or "unknown"

    @tool
    def get_employee_profile() -> str:
        """Retrieve the current employee's profile including name, title, department, and location."""
        return hr_tools.get_employee_profile(username)

    @tool
    def get_pto_balance() -> str:
        """Retrieve the current employee's PTO (Paid Time Off) balance including vacation days, sick days, personal days, accruals, and any pending PTO requests."""
        return hr_tools.get_pto_balance(username)

    @tool
    def submit_pto_request(
        pto_type: str,
        start_date: str,
        end_date: str,
        notes: str = "",
    ) -> str:
        """Submit a PTO request for the current employee.

        Args:
            pto_type: Type of PTO ('Vacation', 'Sick', 'Personal', 'Bereavement')
            start_date: Start date in YYYY-MM-DD format
            end_date: End date in YYYY-MM-DD format
            notes: Optional notes or reason for the request
        """
        return hr_tools.submit_pto_request(username, pto_type, start_date, end_date, notes)

    @tool
    def get_open_positions(department: str = "") -> str:
        """Retrieve open job positions at the company, optionally filtered by department.

        Args:
            department: Optional department filter (e.g., 'Engineering', 'HR', 'Operations')
        """
        return hr_tools.get_open_positions(username, department)

    @tool
    def get_onboarding_checklist() -> str:
        """Retrieve the current employee's onboarding checklist and completion progress."""
        return hr_tools.get_onboarding_checklist(username)

    @tool
    def get_performance_review() -> str:
        """Retrieve the current employee's performance review status, cycle, goals completed, and feedback received."""
        return hr_tools.get_performance_review(username)

    @tool
    def submit_performance_review(
        self_rating: str,
        highlights: str,
        development_goals: str,
    ) -> str:
        """Submit a self-assessment for the current performance review cycle.

        Args:
            self_rating: Self-rating (e.g., 'Exceeds Expectations', 'Meets Expectations', 'Below Expectations')
            highlights: Key accomplishments and contributions this cycle
            development_goals: Goals and areas of focus for the next cycle
        """
        return hr_tools.submit_performance_review(username, self_rating, highlights, development_goals)

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
            get_employee_profile,
            get_pto_balance,
            submit_pto_request,
            get_open_positions,
            get_onboarding_checklist,
            get_performance_review,
            submit_performance_review,
        ],
        system_prompt=system_prompt,
        name="HR Agent",
        description="HR specialist agent for employee profiles, PTO, performance reviews, open positions, and onboarding.",
    )


def process_query(query: str, user_id: str = None) -> str:
    """Process an HR query using the agent."""
    logger.info(f"Processing HR query (user={user_id}): {query[:100]}")
    agent = create_agent(user_id=user_id)
    result = agent(query)
    return str(result)
