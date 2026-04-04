import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/prompt
 * Reads SYSTEM_PROMPT from the orchestration agent source file.
 */
export async function GET() {
  try {
    const agentPath = path.resolve(
      process.cwd(),
      "../agents/orchestrator/src/agent.py"
    );
    const content = fs.readFileSync(agentPath, "utf-8");

    const match = content.match(/SYSTEM_PROMPT\s*=\s*"""([\s\S]*?)"""/);
    const systemPrompt = match ? match[1].trim() : null;

    return NextResponse.json({ systemPrompt });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
