"""Knowledge Domain Tools - Business Logic

Standalone functions for company knowledge: policies, handbook,
office information, and general knowledge base search.
Data comes from the global DynamoDB table (no RBAC — shared reference data).
"""

import json

from shared.dynamo_client import query_global_items, get_global_item


def search_company_policies(query: str) -> str:
    """Search company policies matching the query."""
    query_lower = query.lower()
    all_policies = query_global_items("POLICY")
    matched = []

    for policy in all_policies:
        searchable = (
            policy.get("title", "").lower() + " " +
            policy.get("summary", "").lower() + " " +
            (" ".join(policy.get("sections", [])) if isinstance(policy.get("sections"), list) else str(policy.get("sections", "")))
        )
        if any(word in searchable for word in query_lower.split()):
            matched.append(policy)

    if not matched:
        matched = all_policies

    return json.dumps({
        "query": query,
        "policies_found": len(matched),
        "policies": matched,
    }, indent=2)


def get_policy(policy_name: str) -> str:
    """Retrieve a specific company policy by name or keyword."""
    policy_lower = policy_name.lower()
    all_policies = query_global_items("POLICY")

    # Try direct key or title match
    for policy in all_policies:
        pk = policy.get("PK", "")
        key = pk.replace("POLICY#", "") if pk.startswith("POLICY#") else ""
        if policy_lower in key or policy_lower in policy.get("title", "").lower():
            policy_clean = {k: v for k, v in policy.items() if k != "PK"}
            return json.dumps({"policy": policy_clean}, indent=2)

    # Fuzzy match
    for policy in all_policies:
        if any(word in policy.get("title", "").lower() for word in policy_lower.split()):
            policy_clean = {k: v for k, v in policy.items() if k != "PK"}
            return json.dumps({"policy": policy_clean}, indent=2)

    return json.dumps({
        "message": f"Policy '{policy_name}' not found.",
        "available_policies": [p.get("title", "") for p in all_policies],
    }, indent=2)


def get_office_info(location: str = "") -> str:
    """Retrieve office location information and amenities."""
    all_offices = query_global_items("OFFICE")

    if location:
        location_lower = location.lower()
        for office in all_offices:
            pk = office.get("PK", "")
            key = pk.replace("OFFICE#", "") if pk.startswith("OFFICE#") else ""
            if location_lower in office.get("city", "").lower() or location_lower in key:
                office_clean = {k: v for k, v in office.items() if k != "PK"}
                return json.dumps({"office": office_clean}, indent=2)
        return json.dumps({
            "message": f"Office location '{location}' not found.",
            "available_offices": [o.get("city", "") for o in all_offices],
        }, indent=2)

    offices_clean = [{k: v for k, v in o.items() if k != "PK"} for o in all_offices]
    return json.dumps({
        "offices": offices_clean,
        "total_offices": len(offices_clean),
    }, indent=2)


def get_employee_handbook(section: str = "") -> str:
    """Retrieve sections from the employee handbook."""
    all_sections = query_global_items("HANDBOOK")

    if section:
        section_lower = section.lower()
        for s in all_sections:
            pk = s.get("PK", "")
            key = pk.replace("HANDBOOK#", "") if pk.startswith("HANDBOOK#") else ""
            if section_lower in key or section_lower in s.get("title", "").lower():
                section_clean = {k: v for k, v in s.items() if k != "PK"}
                return json.dumps({"section": section_clean}, indent=2)
        return json.dumps({
            "message": f"Handbook section '{section}' not found.",
            "available_sections": [s.get("title", "") for s in all_sections],
        }, indent=2)

    return json.dumps({
        "handbook_sections": [
            {"key": s.get("PK", "").replace("HANDBOOK#", ""), "title": s.get("title", "")}
            for s in all_sections
        ],
        "total_sections": len(all_sections),
    }, indent=2)


def search_knowledge_base(query: str) -> str:
    """Search across all company knowledge including policies, handbook, and office info."""
    results = []
    query_lower = query.lower()

    # Search policies
    for policy in query_global_items("POLICY"):
        searchable = policy.get("title", "").lower() + " " + policy.get("summary", "").lower()
        if any(word in searchable for word in query_lower.split() if len(word) > 3):
            results.append({
                "type": "policy",
                "title": policy.get("title", ""),
                "summary": policy.get("summary", ""),
                "relevance": "high",
            })

    # Search handbook
    for section in query_global_items("HANDBOOK"):
        searchable = section.get("title", "").lower() + " " + " ".join(str(v) for v in section.values())
        if any(word in searchable for word in query_lower.split() if len(word) > 3):
            results.append({
                "type": "handbook",
                "title": section.get("title", ""),
                "relevance": "medium",
            })

    # Search offices
    for office in query_global_items("OFFICE"):
        if any(word in office.get("city", "").lower() for word in query_lower.split() if len(word) > 3):
            results.append({
                "type": "office",
                "title": f"Office: {office.get('city', '')}",
                "address": office.get("address", ""),
                "relevance": "high",
            })

    if not results:
        return json.dumps({
            "query": query,
            "message": "No specific results found. Try a more specific query.",
            "suggestions": [
                "Try searching for 'PTO policy', 'remote work', 'expense reimbursement'",
                "Ask about a specific office location like 'San Francisco office'",
                "Look up handbook sections like 'benefits', 'parental leave'",
            ],
        }, indent=2)

    return json.dumps({
        "query": query,
        "results_found": len(results),
        "results": results,
    }, indent=2)
