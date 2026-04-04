"""Knowledge Agent - Strands Agent with company knowledge domain tools."""

import logging
import os

from strands import Agent, tool
from strands.models.bedrock import BedrockModel

import tools as knowledge_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Company Knowledge specialist agent for an enterprise organization.

You help employees find information about:
- Company policies (PTO, remote work, expenses, code of conduct)
- Employee handbook sections (benefits, practices, HR processes)
- Office locations, amenities, and directions
- General company knowledge base search

Use your tools to handle knowledge queries accurately.
"""


def create_agent(user_id: str = None) -> Agent:
    """Create a Knowledge specialist Strands Agent."""

    @tool
    def search_company_policies(query: str) -> str:
        """Search for company policies matching a query. Returns relevant policy documents including titles, summaries, and key sections.

        Args:
            query: Search query (e.g., 'vacation days', 'remote work', 'expense reimbursement')
        """
        return knowledge_tools.search_company_policies(query)

    @tool
    def get_policy(policy_name: str) -> str:
        """Retrieve a specific company policy by name. Returns the full policy including all sections and details.

        Args:
            policy_name: Policy name or keyword (e.g., 'PTO policy', 'remote work policy', 'code of conduct')
        """
        return knowledge_tools.get_policy(policy_name)

    @tool
    def get_office_info(location: str = "") -> str:
        """Retrieve office location information including address, floor, amenities, hours, and transit directions.

        Args:
            location: Office city or location name (e.g., 'San Francisco', 'Seattle', 'Austin'). Leave empty for all offices.
        """
        return knowledge_tools.get_office_info(location)

    @tool
    def get_employee_handbook(section: str = "") -> str:
        """Retrieve sections from the employee handbook including benefits, engineering practices, and HR processes.

        Args:
            section: Handbook section name (e.g., 'benefits', 'engineering_practices', 'hr_processes'). Leave empty for table of contents.
        """
        return knowledge_tools.get_employee_handbook(section)

    @tool
    def search_knowledge_base(query: str) -> str:
        """Search across all company knowledge including policies, handbook sections, and office information.

        Args:
            query: Natural language search query
        """
        return knowledge_tools.search_knowledge_base(query)

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
            search_company_policies,
            get_policy,
            get_office_info,
            get_employee_handbook,
            search_knowledge_base,
        ],
        system_prompt=system_prompt,
        name="Knowledge Agent",
        description="Company knowledge agent for policies, handbook, office info, and knowledge base search.",
    )


def process_query(query: str, user_id: str = None) -> str:
    """Process a Knowledge query using the agent."""
    logger.info(f"Processing Knowledge query (user={user_id}): {query[:100]}")
    agent = create_agent(user_id=user_id)
    result = agent(query)
    return str(result)
