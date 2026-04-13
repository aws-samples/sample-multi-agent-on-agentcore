import { NextRequest, NextResponse } from "next/server";
import { searchRegistryAgents } from "@/lib/aws";

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    if (!query) {
      return NextResponse.json({ detail: "Query required" }, { status: 400 });
    }

    const records = await searchRegistryAgents(query);
    return NextResponse.json({ records });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
