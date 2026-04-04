"""IT Support Agent - Strands Agent with IT support domain tools."""

import logging
import os

from strands import Agent, tool
from strands.models.bedrock import BedrockModel

import tools as it_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an IT Support specialist agent for an enterprise organization.

You help employees with IT support queries including:
- Creating and tracking IT support tickets
- Requesting access to software tools and applications
- Hardware and equipment requests
- Checking the status of IT services and systems
- Reviewing current software access and equipment inventory

Use your tools to handle IT requests efficiently and accurately.
"""


def create_agent(user_id: str = None) -> Agent:
    """Create an IT Support specialist Strands Agent."""
    username = user_id or "unknown"

    @tool
    def get_my_tickets() -> str:
        """Retrieve all IT support tickets for the current user, including open, in-progress, and resolved tickets."""
        return it_tools.get_my_tickets(username)

    @tool
    def create_support_ticket(
        issue_type: str,
        description: str,
        priority: str = "medium",
    ) -> str:
        """Create a new IT support ticket for hardware, software, VPN, or other technical issues.

        Args:
            issue_type: Type of issue ('hardware', 'software', 'vpn_access', 'system_provisioning', 'other')
            description: Detailed description of the issue or request
            priority: Priority level ('low', 'medium', 'high', 'critical')
        """
        return it_tools.create_support_ticket(username, issue_type, description, priority)

    @tool
    def request_software_access(
        software_name: str,
        access_level: str = "standard",
        business_justification: str = "",
    ) -> str:
        """Request access to a software tool or application for the current user.

        Args:
            software_name: Name of the software or tool (e.g., 'Salesforce', 'Tableau', 'GitHub')
            access_level: Requested access level (e.g., 'standard', 'admin', 'read_only')
            business_justification: Business reason for needing the access
        """
        return it_tools.request_software_access(username, software_name, access_level, business_justification)

    @tool
    def request_equipment(
        equipment_type: str,
        description: str,
        business_justification: str = "",
    ) -> str:
        """Request new hardware or equipment (laptop, monitor, keyboard, headset, etc.).

        Args:
            equipment_type: Type of equipment ('laptop', 'monitor', 'keyboard', 'headset', 'other')
            description: Specific model or requirements
            business_justification: Business reason for the equipment
        """
        return it_tools.request_equipment(username, equipment_type, description, business_justification)

    @tool
    def get_my_equipment() -> str:
        """Retrieve the list of hardware and equipment currently assigned to the current user."""
        return it_tools.get_my_equipment(username)

    @tool
    def check_service_status(service_name: str = "") -> str:
        """Check the operational status of IT services and systems (email, VPN, GitHub, Jira, etc.).

        Args:
            service_name: Optional specific service to check (e.g., 'VPN', 'email', 'GitHub'). Leave empty for all services.
        """
        return it_tools.check_service_status(service_name)

    @tool
    def get_my_software_access() -> str:
        """Retrieve the list of software tools and applications the current user has access to."""
        return it_tools.get_my_software_access(username)

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
            get_my_tickets,
            create_support_ticket,
            request_software_access,
            request_equipment,
            get_my_equipment,
            check_service_status,
            get_my_software_access,
        ],
        system_prompt=system_prompt,
        name="IT Support Agent",
        description="IT Support specialist agent for tickets, software access, equipment requests, and service status.",
    )


def process_query(query: str, user_id: str = None) -> str:
    """Process an IT Support query using the agent."""
    logger.info(f"Processing IT Support query (user={user_id}): {query[:100]}")
    agent = create_agent(user_id=user_id)
    result = agent(query)
    return str(result)
