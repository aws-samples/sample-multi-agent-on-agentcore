import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const TOOLCALLS_FILE = path.resolve(process.cwd(), ".toolcalls-log.json");

interface ToolCallLog {
  id: string;
  timestamp: number;
  user: string;
  sessionId: string;
  toolName: string;
  agentName: string;
  input: any;
  output?: any;
  status: "pending" | "completed" | "error";
  error?: string;
  duration?: number;
}

type ToolCallStore = ToolCallLog[];

function loadLogs(): ToolCallStore {
  try {
    return JSON.parse(fs.readFileSync(TOOLCALLS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveLogs(logs: ToolCallStore) {
  fs.writeFileSync(TOOLCALLS_FILE, JSON.stringify(logs, null, 2));
}

// GET /api/toolcalls?user=alice&limit=50
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user");
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    let logs = loadLogs();

    // Filter by user if specified
    if (user) {
      logs = logs.filter((log) => log.user === user);
    }

    // Sort by timestamp descending (most recent first)
    logs.sort((a, b) => b.timestamp - a.timestamp);

    // Limit results
    logs = logs.slice(0, limit);

    return NextResponse.json({ toolCalls: logs });
  } catch (err) {
    return NextResponse.json({ detail: (err as Error).message }, { status: 500 });
  }
}

// POST /api/toolcalls
// Body: { id, user, sessionId, toolName, agentName, input }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, user, sessionId, toolName, agentName, input } = body;

    if (!id || !user || !sessionId || !toolName) {
      return NextResponse.json(
        { detail: "id, user, sessionId, and toolName are required" },
        { status: 400 }
      );
    }

    const logs = loadLogs();
    const newLog: ToolCallLog = {
      id,
      timestamp: Date.now(),
      user,
      sessionId,
      toolName,
      agentName: agentName || toolName,
      input,
      status: "pending",
    };

    logs.push(newLog);
    saveLogs(logs);

    return NextResponse.json({ created: true, log: newLog });
  } catch (err) {
    return NextResponse.json({ detail: (err as Error).message }, { status: 500 });
  }
}

// PATCH /api/toolcalls
// Body: { id, output?, error?, duration? }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, output, error, duration } = body;

    if (!id) {
      return NextResponse.json({ detail: "id is required" }, { status: 400 });
    }

    const logs = loadLogs();
    const log = logs.find((l) => l.id === id);

    if (!log) {
      return NextResponse.json({ detail: "Tool call not found" }, { status: 404 });
    }

    if (output !== undefined) {
      log.output = output;
      log.status = "completed";
    }

    if (error !== undefined) {
      log.error = error;
      log.status = "error";
    }

    if (duration !== undefined) {
      log.duration = duration;
    }

    saveLogs(logs);

    return NextResponse.json({ updated: true, log });
  } catch (err) {
    return NextResponse.json({ detail: (err as Error).message }, { status: 500 });
  }
}

// DELETE /api/toolcalls?user=alice  → clear logs for user
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user");

    let logs = loadLogs();
    const originalCount = logs.length;

    if (user) {
      logs = logs.filter((log) => log.user !== user);
    } else {
      logs = [];
    }

    saveLogs(logs);
    const deletedCount = originalCount - logs.length;

    return NextResponse.json({
      deleted: deletedCount,
      message: `${deletedCount} tool call(s) cleared`,
    });
  } catch (err) {
    return NextResponse.json({ detail: (err as Error).message }, { status: 500 });
  }
}
