import { NextRequest, NextResponse } from "next/server";
import { loadSSMConfig, getMemoryClient } from "@/lib/aws";
import {
  ListMemoryRecordsCommand,
  RetrieveMemoryRecordsCommand,
  BatchDeleteMemoryRecordsCommand,
  ListSessionsCommand,
  ListEventsCommand,
  DeleteEventCommand,
} from "@aws-sdk/client-bedrock-agentcore";

async function getMemoryId(): Promise<string> {
  const config = await loadSSMConfig();
  const memoryId = config["memory-id"];
  if (!memoryId) throw new Error("Memory ID not configured in SSM");
  return memoryId;
}

interface MemoryRecord {
  memoryRecordId: string;
  text: string;
  strategyId: string;
  namespaces: string[];
  createdAt?: string;
  score?: number;
}

function parseRecords(summaries: any[]): MemoryRecord[] {
  return summaries.map((r) => ({
    memoryRecordId: r.memoryRecordId || "",
    text: r.content?.text || "",
    strategyId: r.memoryStrategyId || "",
    namespaces: r.namespaces || [],
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : undefined,
    score: r.score,
  }));
}

function filterByActor(records: MemoryRecord[], actorId: string): MemoryRecord[] {
  const pattern = `/actors/${actorId}/`;
  return records.filter((r) =>
    r.namespaces.some((ns: string) => ns.includes(pattern))
  );
}

const SESSION_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function groupByStrategy(records: MemoryRecord[]): Record<string, MemoryRecord[]> {
  const groups: Record<string, MemoryRecord[]> = {};
  for (const r of records) {
    const ns = r.namespaces[0] || "";
    const parts = ns.split("/").filter(Boolean);
    const lastPart = parts[parts.length - 1] || "unknown";
    // Session-level namespaces end with a UUID — use strategyId instead
    const label = SESSION_RE.test(lastPart) ? r.strategyId : lastPart;
    if (!groups[label]) groups[label] = [];
    groups[label].push(r);
  }
  return groups;
}

// GET /api/memory?user=alice
// GET /api/memory?user=alice&q=search+query
// GET /api/memory?user=alice&events=1
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user");
    const query = searchParams.get("q");
    const eventsMode = searchParams.get("events") === "1";

    if (!user) {
      return NextResponse.json({ detail: "user parameter required" }, { status: 400 });
    }

    const memoryId = await getMemoryId();
    const client = getMemoryClient();

    if (eventsMode) {
      const sessionsRes = await client.send(
        new ListSessionsCommand({ memoryId, actorId: user, maxResults: 50 })
      );
      const sessions = sessionsRes.sessionSummaries || [];

      const result = [];
      for (const session of sessions) {
        const sessionId = (session as any).sessionId || "";
        if (!sessionId) continue;
        try {
          const eventsRes = await client.send(
            new ListEventsCommand({
              memoryId,
              actorId: user,
              sessionId,
              maxResults: 100,
            })
          );
          const events = eventsRes.events || (eventsRes as any).eventSummaries || [];
          result.push({
            sessionId,
            createdAt: (session as any).createdAt
              ? new Date((session as any).createdAt).toISOString()
              : undefined,
            events: events.map((e: any) => ({
              eventId: e.eventId || "",
              payload: e.payload,
              createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : undefined,
            })),
          });
        } catch {
          result.push({
            sessionId,
            createdAt: (session as any).createdAt
              ? new Date((session as any).createdAt).toISOString()
              : undefined,
            events: [],
          });
        }
      }

      return NextResponse.json({ sessions: result });
    }

    if (query) {
      // Semantic search
      const res = await client.send(
        new RetrieveMemoryRecordsCommand({
          memoryId,
          namespace: "/",
          searchCriteria: { searchQuery: query, topK: 20 },
        })
      );
      const records = parseRecords(res.memoryRecordSummaries || []);
      const userRecords = filterByActor(records, user);
      return NextResponse.json({
        strategies: groupByStrategy(userRecords),
        total: userRecords.length,
      });
    }

    // List all records (paginate)
    let allRecords: MemoryRecord[] = [];
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new ListMemoryRecordsCommand({
          memoryId,
          namespace: "/",
          maxResults: 100,
          nextToken,
        })
      );
      allRecords.push(...parseRecords(res.memoryRecordSummaries || []));
      nextToken = res.nextToken;
    } while (nextToken);

    const userRecords = filterByActor(allRecords, user);

    return NextResponse.json({
      strategies: groupByStrategy(userRecords),
      total: userRecords.length,
    });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}

// DELETE /api/memory?user=alice
// DELETE /api/memory?user=alice&sessionId=xxx  ← deletes only that session's events
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user");
    const sessionId = searchParams.get("sessionId");

    if (!user) {
      return NextResponse.json({ detail: "user parameter required" }, { status: 400 });
    }

    const memoryId = await getMemoryId();
    const client = getMemoryClient();

    // ── Session-scoped delete ─────────────────────────────────────────────────
    if (sessionId) {
      let deletedEvents = 0;
      try {
        const eventsRes = await client.send(
          new ListEventsCommand({
            memoryId,
            actorId: user,
            sessionId,
            maxResults: 100,
          })
        );
        const events = eventsRes.events || (eventsRes as any).eventSummaries || [];

        for (const event of events) {
          const eventId = (event as any).eventId || "";
          if (!eventId) continue;
          try {
            await client.send(
              new DeleteEventCommand({ memoryId, actorId: user, sessionId, eventId })
            );
            deletedEvents++;
          } catch {
            // Skip individual event deletion failures
          }
        }
      } catch {
        // best-effort
      }
      return NextResponse.json({ deleted: { events: deletedEvents } });
    }

    // ── Full user delete ──────────────────────────────────────────────────────
    let deletedRecords = 0;
    let deletedEvents = 0;

    // 1. Delete long-term memory records
    let allRecords: MemoryRecord[] = [];
    let nextToken: string | undefined;
    do {
      const res = await client.send(
        new ListMemoryRecordsCommand({
          memoryId,
          namespace: "/",
          maxResults: 100,
          nextToken,
        })
      );
      allRecords.push(...parseRecords(res.memoryRecordSummaries || []));
      nextToken = res.nextToken;
    } while (nextToken);

    const userRecords = filterByActor(allRecords, user);

    if (userRecords.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < userRecords.length; i += batchSize) {
        const batch = userRecords.slice(i, i + batchSize);
        await client.send(
          new BatchDeleteMemoryRecordsCommand({
            memoryId,
            records: batch.map((r) => ({ memoryRecordId: r.memoryRecordId })),
          })
        );
        deletedRecords += batch.length;
      }
    }

    // 2. Delete short-term events
    try {
      const sessionsRes = await client.send(
        new ListSessionsCommand({ memoryId, actorId: user, maxResults: 50 })
      );
      const sessions = sessionsRes.sessionSummaries || [];

      for (const session of sessions) {
        const sid = session.sessionId || "";
        if (!sid) continue;

        const eventsRes = await client.send(
          new ListEventsCommand({
            memoryId,
            actorId: user,
            sessionId: sid,
            maxResults: 100,
          })
        );
        const events = eventsRes.events || (eventsRes as any).eventSummaries || [];

        for (const event of events) {
          const eventId = (event as any).eventId || "";
          if (!eventId) continue;
          try {
            await client.send(
              new DeleteEventCommand({ memoryId, actorId: user, sessionId: sid, eventId })
            );
            deletedEvents++;
          } catch {
            // Skip individual event deletion failures
          }
        }
      }
    } catch {
      // Sessions/events cleanup is best-effort
    }

    return NextResponse.json({
      deleted: { records: deletedRecords, events: deletedEvents },
    });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
