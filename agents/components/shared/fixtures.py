"""Centralized per-user fixture data for all 5 MCP agent domains.

Users: alice (HR Manager), bob (Software Engineer), charlie (Business Analyst).

Each domain section is a dict keyed by username → domain-specific data.
"""

# ============================================================================
# User profiles
# ============================================================================

USERS = {
    "alice": {"name": "Alice Johnson", "employee_id": "EMP-001", "title": "HR Manager", "department": "Human Resources", "location": "San Francisco, CA"},
    "bob": {"name": "Bob Williams", "employee_id": "EMP-002", "title": "Software Engineer", "department": "Engineering", "location": "Seattle, WA"},
    "charlie": {"name": "Charlie Davis", "employee_id": "EMP-003", "title": "Business Analyst", "department": "Operations", "location": "Austin, TX"},
}


def resolve_user(username: str) -> str:
    """Normalize username to a known fixture key, defaulting to 'alice'."""
    key = (username or "").lower().strip()
    return key if key in USERS else "alice"


# ============================================================================
# 1. HR
# ============================================================================

PTO_BALANCES = {
    "alice": {"vacation_days": 12.5, "sick_days": 8.0, "personal_days": 3.0, "total_available": 23.5, "used_ytd": 6.5},
    "bob": {"vacation_days": 8.0, "sick_days": 10.0, "personal_days": 2.0, "total_available": 20.0, "used_ytd": 4.0},
    "charlie": {"vacation_days": 15.0, "sick_days": 5.5, "personal_days": 3.0, "total_available": 23.5, "used_ytd": 9.5},
}

PTO_REQUESTS = {
    "alice": [
        {"request_id": "PTO-2026-041", "type": "Vacation", "start_date": "2026-03-17", "end_date": "2026-03-21", "days": 5, "status": "approved", "approver": "VP of HR"},
        {"request_id": "PTO-2026-028", "type": "Sick", "start_date": "2026-02-10", "end_date": "2026-02-11", "days": 2, "status": "approved", "approver": "VP of HR"},
    ],
    "bob": [
        {"request_id": "PTO-2026-052", "type": "Vacation", "start_date": "2026-04-07", "end_date": "2026-04-11", "days": 5, "status": "pending", "approver": "Engineering Manager"},
        {"request_id": "PTO-2026-039", "type": "Personal", "start_date": "2026-02-28", "end_date": "2026-02-28", "days": 1, "status": "approved", "approver": "Engineering Manager"},
    ],
    "charlie": [
        {"request_id": "PTO-2026-063", "type": "Vacation", "start_date": "2026-05-26", "end_date": "2026-05-30", "days": 5, "status": "approved", "approver": "Operations Director"},
    ],
}

PERFORMANCE_REVIEWS = {
    "alice": {"cycle": "FY2026-H1", "status": "pending_submission", "self_rating": None, "goals_completed": "4/5", "feedback_received": 6, "next_deadline": "2026-03-31"},
    "bob": {"cycle": "FY2026-H1", "status": "self_assessment_complete", "self_rating": "Exceeds Expectations", "goals_completed": "3/4", "feedback_received": 4, "next_deadline": "2026-03-31"},
    "charlie": {"cycle": "FY2026-H1", "status": "pending_submission", "self_rating": None, "goals_completed": "5/6", "feedback_received": 3, "next_deadline": "2026-03-31"},
}

OPEN_POSITIONS = {
    "alice": [
        {"req_id": "REQ-2026-018", "title": "Senior HR Business Partner", "department": "Human Resources", "location": "San Francisco, CA", "level": "Senior", "posted_date": "2026-02-01", "status": "active", "applicants": 24},
        {"req_id": "REQ-2026-025", "title": "Talent Acquisition Specialist", "department": "Human Resources", "location": "Remote", "level": "Mid", "posted_date": "2026-02-14", "status": "active", "applicants": 41},
    ],
    "bob": [
        {"req_id": "REQ-2026-011", "title": "Senior Software Engineer - Platform", "department": "Engineering", "location": "Seattle, WA", "level": "Senior", "posted_date": "2026-01-20", "status": "active", "applicants": 58},
        {"req_id": "REQ-2026-031", "title": "Staff Engineer - Infrastructure", "department": "Engineering", "location": "Remote", "level": "Staff", "posted_date": "2026-02-18", "status": "active", "applicants": 19},
    ],
    "charlie": [
        {"req_id": "REQ-2026-022", "title": "Business Analyst - Supply Chain", "department": "Operations", "location": "Austin, TX", "level": "Mid", "posted_date": "2026-02-08", "status": "active", "applicants": 33},
    ],
}

ONBOARDING_CHECKLISTS = {
    "alice": [
        {"task": "Complete I-9 verification", "status": "completed", "due": "Day 1"},
        {"task": "Set up HR systems access (Workday, BambooHR)", "status": "completed", "due": "Day 1"},
        {"task": "Review company HR policies", "status": "completed", "due": "Week 1"},
        {"task": "Schedule 1:1 with VP of HR", "status": "completed", "due": "Week 1"},
        {"task": "Complete mandatory compliance training", "status": "in_progress", "due": "Week 2"},
    ],
    "bob": [
        {"task": "Laptop setup and dev environment", "status": "completed", "due": "Day 1"},
        {"task": "GitHub access and repo onboarding", "status": "completed", "due": "Day 1"},
        {"task": "Review engineering runbook", "status": "completed", "due": "Week 1"},
        {"task": "Complete security awareness training", "status": "completed", "due": "Week 2"},
        {"task": "First PR merged", "status": "in_progress", "due": "Week 3"},
    ],
    "charlie": [
        {"task": "System access setup (Jira, Confluence, Tableau)", "status": "completed", "due": "Day 1"},
        {"task": "Meet with Operations Director", "status": "completed", "due": "Week 1"},
        {"task": "Review current project portfolio", "status": "completed", "due": "Week 1"},
        {"task": "Shadow senior analyst for 2 weeks", "status": "in_progress", "due": "Week 3"},
        {"task": "Complete data governance training", "status": "pending", "due": "Week 4"},
    ],
}

# ============================================================================
# 2. IT Support
# ============================================================================

IT_TICKETS = {
    "alice": [
        {"ticket_id": "IT-2026-0891", "issue_type": "software", "description": "Workday HRIS not loading performance module", "priority": "high", "status": "in_progress", "created": "2026-02-10", "assigned_to": "IT Service Desk", "sla": "4 hours"},
        {"ticket_id": "IT-2026-0845", "issue_type": "hardware", "description": "Second monitor not detected after OS update", "priority": "medium", "status": "resolved", "created": "2026-02-05", "resolved_date": "2026-02-06", "assigned_to": "Desktop Support"},
    ],
    "bob": [
        {"ticket_id": "IT-2026-0903", "issue_type": "vpn_access", "description": "Unable to connect to VPN from home office", "priority": "high", "status": "open", "created": "2026-02-11", "assigned_to": "Network Team", "sla": "4 hours"},
        {"ticket_id": "IT-2026-0872", "issue_type": "software", "description": "Docker Desktop license expired, need renewal", "priority": "medium", "status": "resolved", "created": "2026-02-07", "resolved_date": "2026-02-08"},
    ],
    "charlie": [
        {"ticket_id": "IT-2026-0915", "issue_type": "software", "description": "Tableau Desktop upgrade request to version 2026.1", "priority": "low", "status": "pending_approval", "created": "2026-02-12", "assigned_to": "Software Team"},
    ],
}

SOFTWARE_ACCESS = {
    "alice": [
        {"tool": "Workday", "access_level": "HR Admin", "status": "active"},
        {"tool": "BambooHR", "access_level": "Full Access", "status": "active"},
        {"tool": "LinkedIn Recruiter", "access_level": "Seat License", "status": "active"},
        {"tool": "Microsoft 365", "access_level": "Business Premium", "status": "active"},
        {"tool": "Zoom", "access_level": "Pro", "status": "active"},
    ],
    "bob": [
        {"tool": "GitHub Enterprise", "access_level": "Developer", "status": "active"},
        {"tool": "AWS Console", "access_level": "Developer Role", "status": "active"},
        {"tool": "Jira", "access_level": "Full Member", "status": "active"},
        {"tool": "Datadog", "access_level": "Viewer", "status": "active"},
        {"tool": "Docker Desktop", "access_level": "Pro License", "status": "active"},
    ],
    "charlie": [
        {"tool": "Tableau", "access_level": "Creator", "status": "active"},
        {"tool": "Jira", "access_level": "Full Member", "status": "active"},
        {"tool": "Confluence", "access_level": "Full Access", "status": "active"},
        {"tool": "Salesforce", "access_level": "Read Only", "status": "active"},
        {"tool": "Snowflake", "access_level": "Analyst Role", "status": "active"},
    ],
}

EQUIPMENT_INVENTORY = {
    "alice": [
        {"item": "MacBook Pro 14\" M3", "serial": "C02XL4MDJGH7", "assigned": "2025-08-15", "status": "active"},
        {"item": "LG 27\" 4K Monitor", "serial": "LG-027-2025-448", "assigned": "2025-08-15", "status": "active"},
        {"item": "Logitech MX Keys", "serial": "LGT-MXK-9901", "assigned": "2025-08-15", "status": "active"},
    ],
    "bob": [
        {"item": "MacBook Pro 16\" M3 Pro", "serial": "C02XM8NJGH2", "assigned": "2025-06-01", "status": "active"},
        {"item": "Dell 32\" UHD Monitor x2", "serial": "DL-U3223QE-002", "assigned": "2025-06-01", "status": "active"},
        {"item": "Keychron K3 Keyboard", "serial": "KCH-K3-7712", "assigned": "2025-06-01", "status": "active"},
    ],
    "charlie": [
        {"item": "MacBook Air 13\" M3", "serial": "C02XN2PKGH5", "assigned": "2025-09-01", "status": "active"},
        {"item": "Samsung 27\" Monitor", "serial": "SAM-S27A800-334", "assigned": "2025-09-01", "status": "active"},
    ],
}

SERVICE_STATUS = {
    "email": {"service": "Email (Microsoft 365)", "status": "operational", "uptime": "99.98%"},
    "vpn": {"service": "VPN (Cisco AnyConnect)", "status": "degraded", "incident": "Intermittent connectivity issues in US-West region", "started": "2026-02-11 09:00 UTC"},
    "jira": {"service": "Jira / Confluence", "status": "operational", "uptime": "99.95%"},
    "github": {"service": "GitHub Enterprise", "status": "operational", "uptime": "99.99%"},
    "slack": {"service": "Slack", "status": "operational", "uptime": "99.97%"},
    "aws": {"service": "AWS Internal Tools", "status": "operational", "uptime": "99.99%"},
}

# ============================================================================
# 3. Finance
# ============================================================================

EXPENSE_REPORTS = {
    "alice": [
        {"expense_id": "EXP-2026-0551", "description": "Interview lunch - Senior HRBP candidates (3 people)", "amount": "$124.50", "category": "Business Meals", "date": "2026-02-08", "status": "approved", "reimbursement_date": "2026-02-15"},
        {"expense_id": "EXP-2026-0538", "description": "SHRM Annual Conference registration", "amount": "$1,295.00", "category": "Professional Development", "date": "2026-01-31", "status": "approved", "reimbursement_date": "2026-02-07"},
        {"expense_id": "EXP-2026-0572", "description": "Office supplies - onboarding kits (5 new hires)", "amount": "$287.40", "category": "Office Supplies", "date": "2026-02-12", "status": "pending_approval"},
    ],
    "bob": [
        {"expense_id": "EXP-2026-0561", "description": "AWS re:Invent conference travel - hotel (4 nights)", "amount": "$896.00", "category": "Travel", "date": "2026-01-28", "status": "approved", "reimbursement_date": "2026-02-04"},
        {"expense_id": "EXP-2026-0544", "description": "Technical books - System Design Interview Vol 3", "amount": "$49.99", "category": "Professional Development", "date": "2026-02-03", "status": "approved", "reimbursement_date": "2026-02-10"},
    ],
    "charlie": [
        {"expense_id": "EXP-2026-0580", "description": "Team offsite dinner - Q1 planning session", "amount": "$312.00", "category": "Business Meals", "date": "2026-02-14", "status": "pending_approval"},
        {"expense_id": "EXP-2026-0555", "description": "Tableau Desktop annual license renewal", "amount": "$840.00", "category": "Software", "date": "2026-02-01", "status": "approved", "reimbursement_date": "2026-02-08"},
    ],
}

BUDGETS = {
    "alice": {
        "department": "Human Resources",
        "fiscal_year": "FY2026",
        "total_budget": "$450,000",
        "spent_ytd": "$112,480",
        "remaining": "$337,520",
        "utilization": "25%",
        "categories": {
            "Recruiting": {"budget": "$180,000", "spent": "$42,300", "remaining": "$137,700"},
            "Training & Development": {"budget": "$90,000", "spent": "$28,150", "remaining": "$61,850"},
            "HR Technology": {"budget": "$75,000", "spent": "$25,000", "remaining": "$50,000"},
            "Employee Programs": {"budget": "$60,000", "spent": "$12,400", "remaining": "$47,600"},
            "Operations": {"budget": "$45,000", "spent": "$4,630", "remaining": "$40,370"},
        },
    },
    "bob": {
        "department": "Engineering",
        "fiscal_year": "FY2026",
        "total_budget": "$2,400,000",
        "spent_ytd": "$523,200",
        "remaining": "$1,876,800",
        "utilization": "22%",
        "categories": {
            "Cloud Infrastructure": {"budget": "$960,000", "spent": "$215,400", "remaining": "$744,600"},
            "Software & Licenses": {"budget": "$360,000", "spent": "$87,600", "remaining": "$272,400"},
            "Hardware": {"budget": "$240,000", "spent": "$54,800", "remaining": "$185,200"},
            "Training": {"budget": "$180,000", "spent": "$31,200", "remaining": "$148,800"},
            "Contractors": {"budget": "$660,000", "spent": "$134,200", "remaining": "$525,800"},
        },
    },
    "charlie": {
        "department": "Operations",
        "fiscal_year": "FY2026",
        "total_budget": "$620,000",
        "spent_ytd": "$148,750",
        "remaining": "$471,250",
        "utilization": "24%",
        "categories": {
            "Analytics Tools": {"budget": "$120,000", "spent": "$42,000", "remaining": "$78,000"},
            "Process Improvement": {"budget": "$180,000", "spent": "$38,500", "remaining": "$141,500"},
            "Training": {"budget": "$80,000", "spent": "$22,750", "remaining": "$57,250"},
            "Consulting": {"budget": "$180,000", "spent": "$36,500", "remaining": "$143,500"},
            "Operations": {"budget": "$60,000", "spent": "$9,000", "remaining": "$51,000"},
        },
    },
}

INVOICES = {
    "alice": [
        {"invoice_id": "INV-2026-HR-0042", "vendor": "LinkedIn Recruiter", "amount": "$12,000", "description": "Q1 2026 Recruiter Seat Licenses (3 seats)", "status": "paid", "due_date": "2026-02-01", "paid_date": "2026-01-28"},
        {"invoice_id": "INV-2026-HR-0051", "vendor": "BambooHR", "amount": "$8,400", "description": "Annual HRIS subscription renewal", "status": "pending", "due_date": "2026-03-01"},
    ],
    "bob": [
        {"invoice_id": "INV-2026-ENG-0038", "vendor": "AWS", "amount": "$45,230", "description": "February 2026 cloud usage charges", "status": "pending", "due_date": "2026-03-15"},
        {"invoice_id": "INV-2026-ENG-0029", "vendor": "GitHub", "amount": "$3,780", "description": "GitHub Enterprise - Q1 2026 (90 seats)", "status": "paid", "due_date": "2026-02-01", "paid_date": "2026-01-30"},
    ],
    "charlie": [
        {"invoice_id": "INV-2026-OPS-0044", "vendor": "Tableau", "amount": "$14,400", "description": "Tableau Desktop Creator licenses (3 seats)", "status": "approved", "due_date": "2026-02-28"},
        {"invoice_id": "INV-2026-OPS-0035", "vendor": "Snowflake", "amount": "$6,200", "description": "January 2026 Snowflake compute credits", "status": "paid", "due_date": "2026-02-15", "paid_date": "2026-02-12"},
    ],
}

# ============================================================================
# 4. Productivity
# ============================================================================

CALENDAR_EVENTS = {
    "alice": [
        {"event_id": "CAL-9101", "title": "Weekly HR Team Standup", "date": "2026-02-17", "time": "9:00 AM - 9:30 AM", "location": "Zoom", "recurring": True},
        {"event_id": "CAL-9105", "title": "Interview: Senior HRBP Candidate - Round 2", "date": "2026-02-18", "time": "2:00 PM - 3:00 PM", "location": "Conference Room A", "attendees": ["Alice Johnson", "VP of HR", "Hiring Manager"]},
        {"event_id": "CAL-9112", "title": "Q1 HR Planning - All Hands", "date": "2026-02-20", "time": "10:00 AM - 11:30 AM", "location": "Main Auditorium", "attendees": ["All HR Team"]},
    ],
    "bob": [
        {"event_id": "CAL-9108", "title": "Engineering Sprint Planning", "date": "2026-02-17", "time": "10:00 AM - 12:00 PM", "location": "Zoom", "recurring": True},
        {"event_id": "CAL-9115", "title": "Architecture Review: API Gateway Migration", "date": "2026-02-18", "time": "3:00 PM - 4:00 PM", "location": "Conference Room B", "attendees": ["Bob Williams", "Staff Engineer", "Product Manager"]},
        {"event_id": "CAL-9120", "title": "1:1 with Engineering Manager", "date": "2026-02-19", "time": "11:00 AM - 11:30 AM", "location": "Zoom", "recurring": True},
    ],
    "charlie": [
        {"event_id": "CAL-9118", "title": "Operations Weekly Review", "date": "2026-02-17", "time": "1:00 PM - 2:00 PM", "location": "Conference Room C", "recurring": True},
        {"event_id": "CAL-9125", "title": "Q1 Business Review Prep", "date": "2026-02-19", "time": "9:00 AM - 10:00 AM", "location": "Zoom", "attendees": ["Charlie Davis", "Operations Director", "Finance Analyst"]},
        {"event_id": "CAL-9130", "title": "Data Governance Committee", "date": "2026-02-21", "time": "2:00 PM - 3:00 PM", "location": "Virtual", "recurring": True},
    ],
}

DOCUMENTS = {
    "alice": [
        {"doc_id": "DOC-2026-HR-0245", "title": "FY2026 Compensation Bands - Draft", "type": "spreadsheet", "location": "SharePoint/HR/Compensation", "last_modified": "2026-02-11", "owner": "Alice Johnson"},
        {"doc_id": "DOC-2026-HR-0231", "title": "Onboarding Checklist Template v3", "type": "document", "location": "SharePoint/HR/Templates", "last_modified": "2026-02-05", "owner": "Alice Johnson"},
        {"doc_id": "DOC-2026-HR-0218", "title": "Q1 2026 Headcount Plan", "type": "spreadsheet", "location": "SharePoint/HR/Planning", "last_modified": "2026-01-28", "owner": "VP of HR"},
    ],
    "bob": [
        {"doc_id": "DOC-2026-ENG-0312", "title": "API Gateway Migration - Technical Design", "type": "document", "location": "Confluence/Engineering/Architecture", "last_modified": "2026-02-12", "owner": "Bob Williams"},
        {"doc_id": "DOC-2026-ENG-0298", "title": "Q1 Engineering Roadmap", "type": "presentation", "location": "SharePoint/Engineering/Planning", "last_modified": "2026-02-08", "owner": "Engineering Manager"},
        {"doc_id": "DOC-2026-ENG-0285", "title": "On-Call Runbook 2026", "type": "document", "location": "Confluence/Engineering/Operations", "last_modified": "2026-01-31", "owner": "Staff Engineer"},
    ],
    "charlie": [
        {"doc_id": "DOC-2026-OPS-0198", "title": "Supply Chain KPI Dashboard - Q1 2026", "type": "dashboard", "location": "Tableau/Operations/KPIs", "last_modified": "2026-02-13", "owner": "Charlie Davis"},
        {"doc_id": "DOC-2026-OPS-0185", "title": "Process Improvement Proposal - Order Fulfillment", "type": "document", "location": "Confluence/Operations/Projects", "last_modified": "2026-02-09", "owner": "Charlie Davis"},
        {"doc_id": "DOC-2026-OPS-0172", "title": "Q1 Business Review Deck", "type": "presentation", "location": "SharePoint/Operations/Reviews", "last_modified": "2026-02-01", "owner": "Operations Director"},
    ],
}

MEETING_NOTES = {
    "alice": [
        {
            "notes_id": "MN-2026-HR-0142",
            "meeting": "HR Planning - Headcount Review",
            "date": "2026-02-10",
            "attendees": ["Alice Johnson", "VP of HR", "Finance Business Partner"],
            "key_decisions": ["Approved 5 new hires for Q2", "Engineering headcount increased by 3"],
            "action_items": [
                {"owner": "Alice Johnson", "action": "Post 3 new engineering JDs by Feb 20", "due": "2026-02-20"},
                {"owner": "Finance BP", "action": "Confirm budget allocation for new hires", "due": "2026-02-17"},
            ],
        },
    ],
    "bob": [
        {
            "notes_id": "MN-2026-ENG-0158",
            "meeting": "Sprint 12 Retrospective",
            "date": "2026-02-07",
            "attendees": ["Bob Williams", "Engineering Team"],
            "key_decisions": ["Velocity improved 15% QoQ", "Adopt trunk-based development"],
            "action_items": [
                {"owner": "Bob Williams", "action": "Update branching strategy docs", "due": "2026-02-17"},
                {"owner": "Staff Engineer", "action": "Schedule CI/CD pipeline review", "due": "2026-02-19"},
            ],
        },
    ],
    "charlie": [
        {
            "notes_id": "MN-2026-OPS-0125",
            "meeting": "Q1 Business Review Prep",
            "date": "2026-02-12",
            "attendees": ["Charlie Davis", "Operations Director"],
            "key_decisions": ["Focus on 3 KPIs: cost, delivery time, quality", "Present to exec team Feb 28"],
            "action_items": [
                {"owner": "Charlie Davis", "action": "Finalize KPI dashboard by Feb 24", "due": "2026-02-24"},
                {"owner": "Operations Director", "action": "Review deck and provide feedback", "due": "2026-02-26"},
            ],
        },
    ],
}

# ============================================================================
# 5. Knowledge
# ============================================================================

COMPANY_POLICIES = {
    "pto_policy": {
        "title": "Paid Time Off Policy",
        "version": "v3.2 (Jan 2026)",
        "summary": "Full-time employees accrue 15 vacation days, 10 sick days, and 3 personal days per year. PTO accrues bi-weekly. Unused vacation (up to 5 days) rolls over annually.",
        "sections": [
            "Vacation days accrue at 0.577 days/biweekly pay period (15 days/year)",
            "Sick days accrue at 0.384 days/biweekly pay period (10 days/year)",
            "Personal days are front-loaded on Jan 1 (3 days)",
            "PTO requests should be submitted at least 2 weeks in advance",
            "Manager approval required for requests >5 consecutive days",
        ],
    },
    "remote_work_policy": {
        "title": "Remote Work & Flexible Work Policy",
        "version": "v2.1 (Sep 2025)",
        "summary": "Employees may work remotely up to 3 days per week. Core collaboration hours are 10am-3pm local time. In-office days are Tuesday and Thursday for most teams.",
        "sections": [
            "Hybrid schedule: 2 days in-office (Tue/Thu), 3 days remote",
            "Core hours: 10am-3pm local timezone, all team members available",
            "Remote work setup allowance: $500 one-time, $100/month ongoing",
            "VPN required for accessing internal systems remotely",
            "Manager may require additional in-office days for onboarding period",
        ],
    },
    "expense_policy": {
        "title": "Employee Expense Reimbursement Policy",
        "version": "v4.0 (Feb 2026)",
        "summary": "Employees are reimbursed for reasonable business expenses with manager approval. Receipts required for all purchases >$25. Reimbursement processed within 5 business days.",
        "sections": [
            "Meal per diem: $75/day domestic, $100/day international",
            "Hotel: up to $250/night domestic, $350/night international",
            "Airfare: economy class domestic, business class >6 hours",
            "Home office: $500 one-time setup, $100/month stipend",
            "Professional development: up to $2,000/year with manager approval",
        ],
    },
    "code_of_conduct": {
        "title": "Code of Conduct & Ethics Policy",
        "version": "v2.0 (Jan 2025)",
        "summary": "All employees must act with integrity, respect, and professionalism. Zero tolerance for harassment, discrimination, or conflicts of interest.",
        "sections": [
            "Treat all colleagues with respect regardless of role, background, or identity",
            "Report conflicts of interest to HR or Legal immediately",
            "Protect confidential company and customer information",
            "Use company resources (equipment, systems) for business purposes",
            "Report suspected violations through the ethics hotline (anonymous)",
        ],
    },
}

OFFICE_LOCATIONS = {
    "san_francisco": {
        "city": "San Francisco, CA",
        "address": "101 Market Street, Suite 1500, San Francisco, CA 94105",
        "floors": "15-17",
        "capacity": 350,
        "amenities": ["Rooftop terrace", "Gym", "Cafeteria (M-F)", "Bike storage", "EV charging", "Nursing room"],
        "hours": "Monday-Friday 7:00am - 8:00pm",
        "parking": "Validated parking at 100 Mission St ($15/day with validation)",
        "public_transport": "Montgomery BART station (3 min walk), Muni lines 1, 2, 8",
    },
    "seattle": {
        "city": "Seattle, WA",
        "address": "1420 Fifth Avenue, Suite 800, Seattle, WA 98101",
        "floors": "8-9",
        "capacity": 200,
        "amenities": ["Coffee bar", "Standing desks", "Bike storage", "Game room", "Nursing room"],
        "hours": "Monday-Friday 7:30am - 7:00pm",
        "parking": "1420 Fifth Ave Garage ($12/day with validation)",
        "public_transport": "Westlake Station (2 min walk), King County Metro routes 10, 11, 14",
    },
    "austin": {
        "city": "Austin, TX",
        "address": "300 W 6th Street, Suite 1800, Austin, TX 78701",
        "floors": "18",
        "capacity": 150,
        "amenities": ["Rooftop deck", "Catered lunch (Mon/Wed/Fri)", "Standing desks", "Meditation room"],
        "hours": "Monday-Friday 8:00am - 7:00pm",
        "parking": "300 W 6th Garage ($10/day with validation)",
        "public_transport": "MetroRapid Route 801 (4 min walk)",
    },
}

EMPLOYEE_HANDBOOK = {
    "benefits": {
        "title": "Employee Benefits Overview",
        "health_insurance": "Medical, Dental, Vision — 100% premium covered for employee, 80% for dependents. Plans: Blue Cross PPO, Kaiser HMO (CA only), Cigna PPO.",
        "retirement": "401(k) with 4% company match, immediate vesting. ESPP: 15% discount, 24-month offering periods.",
        "wellness": "$150/month wellness stipend (gym, meditation apps, fitness equipment). Mental health: 12 free therapy sessions/year via EAP.",
        "learning": "$2,000/year learning & development budget. Access to LinkedIn Learning, O'Reilly, Coursera.",
        "parental_leave": "16 weeks fully paid parental leave (primary caregiver), 8 weeks (secondary caregiver).",
    },
    "engineering_practices": {
        "title": "Engineering Practices & Standards",
        "code_review": "All changes require at least 1 approval. Security changes require 2 approvals. Use conventional commits.",
        "deployment": "CI/CD via GitHub Actions. All merges to main trigger staging deployment. Production deploys: Tuesday/Thursday release windows.",
        "oncall": "Rotating on-call schedule, 1 week per engineer. PagerDuty for alerting. Runbooks in Confluence.",
        "security": "SAST scanning on every PR. Dependency updates via Dependabot. Security review required for new external API integrations.",
    },
    "hr_processes": {
        "title": "HR Processes & Timelines",
        "hiring": "Typical hiring timeline: 3-4 weeks from job post to offer. Interview loop: recruiter screen → hiring manager → 3-4 panel interviews → offer.",
        "promotions": "Promotion cycles: June and December. Nominations due 6 weeks before cycle close. Level criteria documented in career ladder.",
        "performance": "Performance reviews twice yearly (March and September). 360 feedback collected 3 weeks prior.",
        "offboarding": "2 weeks notice standard. IT equipment return within 5 business days. Final paycheck per state law.",
    },
}
