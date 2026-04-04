import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import path from "path";

/**
 * GET /api/fixtures?username=alice
 *
 * Reads the actual shared/fixtures.py Python file and returns
 * the fixture data for the given user as JSON.
 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username") || "alice";

  // Resolve path to shared/fixtures.py from the project root
  // Frontend CWD: frontend/
  // Fixtures:     agents/components/shared/fixtures.py
  const fixturesDir = path.resolve(
    process.cwd(),
    "../agents/components/shared"
  );

  // User input (username) is passed via environment variable to avoid command injection.
  const script = `
import sys, json, os
sys.path.insert(0, os.environ["FIXTURES_DIR"])
from fixtures import *

user = resolve_user(os.environ.get("USERNAME", "alice"))

data = {
    "user": USERS.get(user, {}),
    "hr": {
        "pto_balances": PTO_BALANCES.get(user, {}),
        "pto_requests": PTO_REQUESTS.get(user, []),
        "performance_reviews": PERFORMANCE_REVIEWS.get(user, {}),
        "open_positions": OPEN_POSITIONS.get(user, []),
        "onboarding_checklists": ONBOARDING_CHECKLISTS.get(user, []),
    },
    "it_support": {
        "it_tickets": IT_TICKETS.get(user, []),
        "software_access": SOFTWARE_ACCESS.get(user, []),
        "equipment_inventory": EQUIPMENT_INVENTORY.get(user, []),
        "service_status": SERVICE_STATUS,
    },
    "finance": {
        "expense_reports": EXPENSE_REPORTS.get(user, []),
        "budgets": BUDGETS.get(user, {}),
        "invoices": INVOICES.get(user, []),
    },
    "productivity": {
        "calendar_events": CALENDAR_EVENTS.get(user, []),
        "documents": DOCUMENTS.get(user, []),
        "meeting_notes": MEETING_NOTES.get(user, []),
    },
    "knowledge": {
        "company_policies": COMPANY_POLICIES,
        "office_locations": OFFICE_LOCATIONS,
        "employee_handbook": EMPLOYEE_HANDBOOK,
    },
}

print(json.dumps(data, default=str))
`;

  try {
    const result = execSync(
      `python3 -c '${script.replace(/'/g, "'\"'\"'")}'`,
      {
        timeout: 10000,
        encoding: "utf-8",
        env: { ...process.env, FIXTURES_DIR: fixturesDir, USERNAME: username },
      }
    );
    return NextResponse.json(JSON.parse(result.trim()));
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
