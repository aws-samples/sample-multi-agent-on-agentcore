import { NextRequest, NextResponse } from "next/server";
import { searchGatewayTools } from "@/lib/aws";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!authToken) {
      return NextResponse.json({ detail: "Auth token required" }, { status: 401 });
    }

    const { query } = await request.json();
    if (!query) {
      return NextResponse.json({ detail: "Query required" }, { status: 400 });
    }

    const result = await searchGatewayTools(authToken, query);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
