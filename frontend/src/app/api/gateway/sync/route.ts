import { NextRequest, NextResponse } from "next/server";
import { syncRegistryRecord, syncAllRegistryRecords } from "@/lib/aws";

/**
 * POST /api/gateway/sync
 * Body: { recordId?: string }
 *   - If recordId provided, trigger sync for that specific record
 *   - If omitted, sync all approved records
 *
 * Triggers Registry URL synchronization — Registry re-fetches tool
 * descriptors from the sub-agent runtime's MCP endpoint.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const recordId: string | undefined = body.recordId;

    if (recordId) {
      const result = await syncRegistryRecord(recordId);
      return NextResponse.json({ synced: [{ recordId, status: "syncing" }] });
    } else {
      const results = await syncAllRegistryRecords();
      return NextResponse.json({ synced: results });
    }
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
