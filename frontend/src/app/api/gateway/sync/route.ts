import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { loadSSMConfig } from "@/lib/aws";

/**
 * POST /api/gateway/sync
 * Body: { targetName?: string }
 *   - If targetName provided, sync that specific target
 *   - If omitted, sync all targets
 *
 * Uses boto3 via subprocess (JS SDK lacks control-plane APIs).
 * User input (targetName) is passed via environment variable to avoid injection.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetName: string | undefined = body.targetName;

    const script = `
import boto3, json, sys, os

region = os.environ.get("AWS_REGION", "us-west-2")
client = boto3.client("bedrock-agentcore-control", region_name=region)

# Find gateway by name prefix
gateways = client.list_gateways()
gw = next((g for g in gateways.get("items", []) if "multi-agent-concierge" in g.get("name", "").lower()), None)
if not gw:
    print(json.dumps({"error": "Gateway not found"}))
    sys.exit(0)

gw_id = gw["gatewayId"]
targets = client.list_gateway_targets(gatewayIdentifier=gw_id)

target_name = os.environ.get("TARGET_NAME") or None
synced = []

for t in targets.get("items", []):
    detail = client.get_gateway_target(gatewayIdentifier=gw_id, targetId=t["targetId"])
    if target_name and detail["name"] != target_name:
        continue
    client.synchronize_gateway_targets(gatewayIdentifier=gw_id, targetIdList=[t["targetId"]])
    synced.append({"targetId": t["targetId"], "name": detail["name"], "status": "synchronizing"})

print(json.dumps({"synced": synced, "gatewayId": gw_id}))
`;

    const result = execSync(`python3 -c '${script.replace(/'/g, "'\"'\"'")}'`, {
      timeout: 30000,
      encoding: "utf-8",
      env: { ...process.env, TARGET_NAME: targetName || "" },
    });

    const data = JSON.parse(result.trim());
    if (data.error) {
      return NextResponse.json(data, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
