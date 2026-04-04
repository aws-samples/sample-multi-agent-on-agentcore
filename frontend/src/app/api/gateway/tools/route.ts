import { NextRequest, NextResponse } from "next/server";
import { listGatewayTools } from "@/lib/aws";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const authToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!authToken) {
      return NextResponse.json({ detail: "Auth token required" }, { status: 401 });
    }

    const tools = await listGatewayTools(authToken);
    return NextResponse.json({ tools });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
