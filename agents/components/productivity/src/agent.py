"""Productivity Agent - Strands Agent with productivity domain tools."""

import logging
import os

from strands import Agent, tool
from strands.models.bedrock import BedrockModel

import tools as productivity_tools

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a Productivity specialist agent for an enterprise organization.

You help employees with productivity and collaboration queries including:
- Calendar events and scheduling
- Document search and retrieval
- Meeting notes creation and lookup
- Task and project tracking

Use your tools to handle productivity requests efficiently and accurately.
"""


def create_agent(user_id: str = None) -> Agent:
    """Create a Productivity specialist Strands Agent."""
    username = user_id or "unknown"

    @tool
    def get_calendar(date_filter: str = "") -> str:
        """Retrieve upcoming calendar events and meetings for the current user.

        Args:
            date_filter: Optional date filter in YYYY-MM-DD format to filter events by date
        """
        return productivity_tools.get_calendar(username, date_filter)

    @tool
    def schedule_meeting(
        title: str,
        date: str,
        time_slot: str,
        duration_minutes: int = 60,
        attendees: str = "",
        location: str = "Zoom",
        agenda: str = "",
    ) -> str:
        """Schedule a new meeting or calendar event.

        Args:
            title: Meeting title
            date: Meeting date in YYYY-MM-DD format
            time_slot: Start time (e.g., '2:00 PM')
            duration_minutes: Duration in minutes (default 60)
            attendees: Comma-separated list of attendee names or emails
            location: Meeting location or video link (default 'Zoom')
            agenda: Meeting agenda or description
        """
        return productivity_tools.schedule_meeting(
            username, title, date, time_slot, duration_minutes, attendees, location, agenda
        )

    @tool
    def search_documents(query: str = "", doc_type: str = "") -> str:
        """Search for documents, presentations, spreadsheets, and reports for the current user.

        Args:
            query: Search query to filter documents by title or content
            doc_type: Optional document type filter ('document', 'spreadsheet', 'presentation', 'report', 'dashboard')
        """
        return productivity_tools.search_documents(username, query, doc_type)

    @tool
    def get_meeting_notes(meeting_filter: str = "") -> str:
        """Retrieve past meeting notes and action items for the current user.

        Args:
            meeting_filter: Optional filter to search meeting notes by meeting title
        """
        return productivity_tools.get_meeting_notes(username, meeting_filter)

    @tool
    def create_meeting_notes(
        meeting_title: str,
        date: str,
        attendees: str,
        key_decisions: str,
        action_items: str,
    ) -> str:
        """Create and save meeting notes for a completed meeting.

        Args:
            meeting_title: Title of the meeting
            date: Meeting date in YYYY-MM-DD format
            attendees: Comma-separated list of attendees
            key_decisions: Semicolon-separated list of key decisions made
            action_items: Semicolon-separated list of action items (owner: action by due date)
        """
        return productivity_tools.create_meeting_notes(
            username, meeting_title, date, attendees, key_decisions, action_items
        )

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
            get_calendar,
            schedule_meeting,
            search_documents,
            get_meeting_notes,
            create_meeting_notes,
        ],
        system_prompt=system_prompt,
        name="Productivity Agent",
        description="Productivity specialist agent for calendar, documents, and meeting notes.",
    )


def process_query(query: str, user_id: str = None) -> str:
    """Process a Productivity query using the agent."""
    logger.info(f"Processing Productivity query (user={user_id}): {query[:100]}")
    agent = create_agent(user_id=user_id)
    result = agent(query)
    return str(result)
