import { NextResponse } from "next/server";
import { USERS, loadSSMConfig } from "@/lib/aws";

export async function GET() {
  try {
    const config = await loadSSMConfig();
    return NextResponse.json({
      users: USERS,
      has_runtime: Boolean(config["runtime-arn"]),
      region: process.env.AWS_REGION || "us-west-2",
    });
  } catch {
    return NextResponse.json({
      users: USERS,
      has_runtime: false,
      region: process.env.AWS_REGION || "us-west-2",
    });
  }
}
