import { NextRequest, NextResponse } from "next/server";
import { callGatewayTool } from "@/lib/aws";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!authToken) {
      return NextResponse.json({ detail: "Auth token required" }, { status: 401 });
    }

    const { toolName, arguments: args } = await request.json();
    if (!toolName) {
      return NextResponse.json({ detail: "toolName required" }, { status: 400 });
    }

    const result = await callGatewayTool(authToken, toolName, args || {});
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
