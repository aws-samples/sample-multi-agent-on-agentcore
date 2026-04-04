/**
 * GET /api/memory/snapshot?user=alice
 *
 * Returns Records + Events in a single response.
 * Used by MemoryPanel's unified polling loop.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadSSMConfig, getMemoryClient } from "@/lib/aws";
import {
  ListMemoryRecordsCommand,
  ListSessionsCommand,
  ListEventsCommand,
} from "@aws-sdk/client-bedrock-agentcore";

async function getMemoryId(): Promise<string> {
  const config = await loadSSMConfig();
  const memoryId = config["memory-id"];
  if (!memoryId) throw new Error("Memory ID not configured in SSM");
  return memoryId;
}

// ── Records helpers ──────────────────────────────────────────────────────────

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

function filterByActor(records: MemoryRecord[], actorId: string) {
  const pattern = `/actors/${actorId}/`;
  return records.filter((r) =>
    r.namespaces.some((ns) => ns.includes(pattern))
  );
}

const SESSION_RE = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function groupByStrategy(
  records: MemoryRecord[]
): Record<string, MemoryRecord[]> {
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

// ── Events helpers ───────────────────────────────────────────────────────────

export interface EventTurn {
  type: "text" | "tool_call";
  role: "user" | "assistant";
  text: string;
}

function parseConversationalPayload(payload: any): EventTurn[] {
  if (!Array.isArray(payload)) return [];

  const entry = payload.find((item: any) => item?.conversational);
  if (!entry) return [];

  const conv = entry.conversational;
  const role: "user" | "assistant" =
    conv.role === "ASSISTANT" ? "assistant" : "user";

  let message: any = null;
  try {
    message = JSON.parse(conv.content?.text || "{}").message;
  } catch {
    const raw = conv.content?.text;
    return raw ? [{ type: "text", role, text: raw }] : [];
  }

  if (!message?.content) return [];

  const turns: EventTurn[] = [];
  for (const item of message.content) {
    if (item.text) {
      turns.push({ type: "text", role, text: item.text });
    } else if (item.toolUse) {
      turns.push({ type: "tool_call", role: "assistant", text: item.toolUse.name });
    }
  }
  return turns;
}

async function fetchEvents(
  client: ReturnType<typeof getMemoryClient>,
  memoryId: string,
  actorId: string
) {
  const sessionsRes = await client.send(
    new ListSessionsCommand({ memoryId, actorId, maxResults: 50 })
  );
  const sessions = sessionsRes.sessionSummaries || [];

  const result = await Promise.all(
    sessions.map(async (session) => {
      const sessionId = (session as any).sessionId || "";
      if (!sessionId) return null;
      try {
        const eventsRes = await client.send(
          new ListEventsCommand({
            memoryId,
            actorId,
            sessionId,
            maxResults: 100,
          })
        );
        const rawEvents =
          eventsRes.events || (eventsRes as any).eventSummaries || [];

        const events = rawEvents
          .map((e: any) => {
            const turns = parseConversationalPayload(e.payload);
            if (turns.length === 0) return null;
            return {
              eventId: e.eventId || "",
              turns,
              createdAt: e.createdAt
                ? new Date(e.createdAt).toISOString()
                : undefined,
            };
          })
          .filter(Boolean)
          .reverse();

        return {
          sessionId,
          createdAt: (session as any).createdAt
            ? new Date((session as any).createdAt).toISOString()
            : undefined,
          events,
        };
      } catch {
        return {
          sessionId,
          createdAt: (session as any).createdAt
            ? new Date((session as any).createdAt).toISOString()
            : undefined,
          events: [],
        };
      }
    })
  );

  return result.filter((s: any) => s && s.events.length > 0);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get("user");

    if (!user) {
      return NextResponse.json(
        { detail: "user parameter required" },
        { status: 400 }
      );
    }

    const memoryId = await getMemoryId();
    const client = getMemoryClient();

    const [recordsResult, eventsResult] = await Promise.allSettled([
      (async () => {
        let allRaw: any[] = [];
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
          allRaw.push(...(res.memoryRecordSummaries || []));
          nextToken = res.nextToken;
        } while (nextToken);
        return allRaw;
      })(),
      fetchEvents(client, memoryId, user),
    ]);

    let recordsResponse = { strategies: {} as Record<string, any[]>, total: 0 };
    if (recordsResult.status === "fulfilled") {
      const parsed = parseRecords(recordsResult.value);
      const userRecords = filterByActor(parsed, user);
      recordsResponse = {
        strategies: groupByStrategy(userRecords),
        total: userRecords.length,
      };
    }

    const eventsResponse = {
      sessions:
        eventsResult.status === "fulfilled" ? eventsResult.value : [],
    };

    return NextResponse.json({
      records: recordsResponse,
      events: eventsResponse,
    });
  } catch (err) {
    return NextResponse.json(
      { detail: (err as Error).message },
      { status: 500 }
    );
  }
}
