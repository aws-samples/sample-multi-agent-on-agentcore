import { NextRequest, NextResponse } from "next/server";
import { listRegistryAgents } from "@/lib/aws";

export async function GET(request: NextRequest) {
  try {
    const agents = await listRegistryAgents();
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
