"""Productivity Domain Tools - Business Logic

Standalone functions for productivity operations: calendar management,
document search, and meeting notes.
Per-user data is read from DynamoDB using RBAC-scoped credentials.
"""

import json

from shared.dynamo_client import query_user_items


def get_calendar(username: str, date_filter: str = "") -> str:
    """Retrieve calendar events for the current user."""
    events = query_user_items("PROD#CALENDAR", username)
    if date_filter:
        events = [e for e in events if date_filter in e.get("date", "")]
    return json.dumps({
        "user": username,
        "calendar_events": events,
        "total_events": len(events),
    }, indent=2)


def schedule_meeting(
    username: str,
    title: str,
    date: str,
    time_slot: str,
    duration_minutes: int = 60,
    attendees: str = "",
    location: str = "Zoom",
    agenda: str = "",
) -> str:
    """Schedule a new meeting or calendar event."""
    event_id = f"CAL-{abs(hash(title + date)) % 9000 + 1000}"
    attendee_list = [a.strip() for a in attendees.split(",") if a.strip()] if attendees else []
    return json.dumps({
        "status": "scheduled",
        "event_id": event_id,
        "organizer": username,
        "title": title,
        "date": date,
        "time": time_slot,
        "duration_minutes": duration_minutes,
        "location": location,
        "attendees": attendee_list,
        "agenda": agenda or "No agenda provided",
        "calendar_invite_sent": bool(attendee_list),
    }, indent=2)


def search_documents(username: str, query: str = "", doc_type: str = "") -> str:
    """Search for documents relevant to the current user."""
    docs = query_user_items("PROD#DOCUMENT", username)
    if query:
        docs = [d for d in docs if query.lower() in d.get("title", "").lower() or query.lower() in d.get("type", "").lower()]
    if doc_type:
        docs = [d for d in docs if doc_type.lower() in d.get("type", "").lower()]
    return json.dumps({
        "user": username,
        "documents": docs,
        "total_found": len(docs),
    }, indent=2)


def get_meeting_notes(username: str, meeting_filter: str = "") -> str:
    """Retrieve meeting notes for the current user."""
    notes = query_user_items("PROD#MEETING_NOTES", username)
    if meeting_filter:
        notes = [n for n in notes if meeting_filter.lower() in n.get("meeting", "").lower()]
    return json.dumps({
        "user": username,
        "meeting_notes": notes,
        "total_found": len(notes),
    }, indent=2)


def create_meeting_notes(
    username: str,
    meeting_title: str,
    date: str,
    attendees: str,
    key_decisions: str,
    action_items: str,
) -> str:
    """Create and save meeting notes."""
    notes_id = f"MN-2026-{abs(hash(meeting_title + date)) % 9000 + 1000}"
    attendee_list = [a.strip() for a in attendees.split(",") if a.strip()]
    decisions_list = [d.strip() for d in key_decisions.split(";") if d.strip()]
    actions_list = [a.strip() for a in action_items.split(";") if a.strip()]
    return json.dumps({
        "status": "saved",
        "notes_id": notes_id,
        "created_by": username,
        "meeting": meeting_title,
        "date": date,
        "attendees": attendee_list,
        "key_decisions": decisions_list,
        "action_items": actions_list,
        "stored_in": "Confluence/MeetingNotes",
    }, indent=2)
