/**
 * Server-side AWS SDK utilities.
 * Only import this file from app/api/ route handlers.
 */

import {
  SSMClient,
  GetParametersCommand,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  SearchRegistryRecordsCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import {
  BedrockAgentCoreControlClient,
  ListRegistryRecordsCommand,
  GetRegistryRecordCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

const PROJECT_NAME = "multi-agent-concierge";
const ENVIRONMENT = "dev";
const AWS_REGION = process.env.AWS_REGION || "us-west-2";
const PASSWORD = process.env.DEMO_PASSWORD || "Password123!";

export const USERS: Record<string, { name: string; employee_id: string }> = {
  alice: { name: "Alice Johnson", employee_id: "EMP-001" },
  bob: { name: "Bob Williams", employee_id: "EMP-002" },
  charlie: { name: "Charlie Davis", employee_id: "EMP-003" },
};

// --- SSM Config (cached) ---

let cachedConfig: Record<string, string> | null = null;

export async function loadSSMConfig(): Promise<Record<string, string>> {
  if (cachedConfig) return cachedConfig;

  const ssm = new SSMClient({ region: AWS_REGION });
  const prefix = `/${PROJECT_NAME}/${ENVIRONMENT}`;

  const cmd = new GetParametersCommand({
    Names: [
      `${prefix}/agentcore/runtime-arn`,
      `${prefix}/agentcore/memory-id`,
      `${prefix}/auth/user-pool-id`,
      `${prefix}/auth/user-client-id`,
      `${prefix}/registry/registry-id`,
    ],
  });

  const res = await ssm.send(cmd);
  const params: Record<string, string> = {};
  for (const p of res.Parameters || []) {
    const key = p.Name!.split("/").pop()!;
    params[key] = p.Value!;
  }

  cachedConfig = params;
  return params;
}

// --- Cognito Auth ---

export async function authenticateUser(username: string): Promise<string> {
  const config = await loadSSMConfig();
  const clientId = config["user-client-id"];
  if (!clientId) throw new Error("Auth config not available");

  const cognito = new CognitoIdentityProviderClient({ region: AWS_REGION });
  const cmd = new InitiateAuthCommand({
    ClientId: clientId,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: username, PASSWORD },
  });

  const res = await cognito.send(cmd);
  return res.AuthenticationResult!.AccessToken!;
}

// --- AgentCore Runtime ---

export async function invokeAgentRuntime(
  userId: string,
  sessionId: string,
  message: string,
  authToken: string,
  useSearch: boolean = false
): Promise<ReadableStream> {
  const config = await loadSSMConfig();
  const runtimeArn = config["runtime-arn"];
  if (!runtimeArn) throw new Error("Runtime ARN not configured");

  const client = new BedrockAgentCoreClient({ region: AWS_REGION });

  const payloadInput: Record<string, unknown> = {
    message,
    user_id: userId,
    session_id: sessionId,
    use_search: useSearch,
  };
  if (authToken) {
    payloadInput.auth_token = authToken;
  }

  const cmd = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    qualifier: "DEFAULT",
    contentType: "application/json",
    accept: "text/event-stream",
    payload: Buffer.from(JSON.stringify({ input: payloadInput })),
    runtimeUserId: userId,
    runtimeSessionId: sessionId,
  });

  const res = await client.send(cmd);
  if (!res.response) throw new Error("No response stream from AgentCore");

  const sdkStream = res.response as unknown as NodeJS.ReadableStream;

  // Convert Node stream → Web ReadableStream
  return new ReadableStream({
    start(controller) {
      sdkStream.on("data", (chunk: Buffer) => {
        controller.enqueue(chunk);
      });
      sdkStream.on("end", () => {
        controller.close();
      });
      sdkStream.on("error", (err: Error) => {
        controller.error(err);
      });
    },
    cancel() {
      if (typeof (sdkStream as any).destroy === "function") {
        (sdkStream as any).destroy();
      }
    },
  });
}

// --- MCP Gateway ---

let cachedGatewayUrl: string | null = null;

export async function getGatewayUrl(): Promise<string> {
  if (cachedGatewayUrl) return cachedGatewayUrl;

  const ssm = new SSMClient({ region: AWS_REGION });
  const cmd = new GetParameterCommand({
    Name: `/${PROJECT_NAME}/${ENVIRONMENT}/mcp/gateway-url`,
  });

  const res = await ssm.send(cmd);
  const url = res.Parameter?.Value;
  if (!url) throw new Error("Gateway URL not found in SSM");

  cachedGatewayUrl = url;
  return url;
}

export async function listRegistryAgents() {
  const config = await loadSSMConfig();
  const registryId = config["registry-id"];
  if (!registryId) throw new Error("Registry ID not configured");

  const client = new BedrockAgentCoreControlClient({ region: AWS_REGION });
  const res = await client.send(
    new ListRegistryRecordsCommand({ registryId })
  );

  const records = (res.registryRecords || []).filter(
    (r) => r.status === "APPROVED" && r.descriptorType === "MCP"
  );
  return records;
}

export async function getRegistryRecord(recordId: string) {
  const config = await loadSSMConfig();
  const registryId = config["registry-id"];
  if (!registryId) throw new Error("Registry ID not configured");

  const client = new BedrockAgentCoreControlClient({ region: AWS_REGION });
  const res = await client.send(
    new GetRegistryRecordCommand({ registryId, recordId })
  );
  return res;
}

export async function syncRegistryRecord(recordId: string) {
  const config = await loadSSMConfig();
  const registryId = config["registry-id"];
  if (!registryId) throw new Error("Registry ID not configured");

  const { UpdateRegistryRecordCommand } = await import(
    "@aws-sdk/client-bedrock-agentcore-control"
  );
  const client = new BedrockAgentCoreControlClient({ region: AWS_REGION });
  const res = await client.send(
    new UpdateRegistryRecordCommand({
      registryId,
      recordId,
      triggerSynchronization: true,
    })
  );
  return res;
}

export async function syncAllRegistryRecords() {
  const agents = await listRegistryAgents();
  const results = [];
  for (const agent of agents) {
    if (agent.recordId) {
      try {
        await syncRegistryRecord(agent.recordId);
        results.push({ name: agent.name, status: "synced" });
      } catch (err) {
        results.push({ name: agent.name, status: "failed", error: (err as Error).message });
      }
    }
  }
  return results;
}

export async function callGatewayTool(
  authToken: string,
  toolName: string,
  args: Record<string, unknown>
) {
  const gatewayUrl = await getGatewayUrl();

  const body = {
    jsonrpc: "2.0",
    id: "tool-call-request",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args,
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    const token = authToken.replace(/^Bearer\s+/i, "");
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(gatewayUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Gateway tool call failed: ${res.status}`);
  }

  return res.json();
}

// --- AgentCore Memory Client ---

export function getMemoryClient() {
  return new BedrockAgentCoreClient({ region: AWS_REGION });
}

export async function searchRegistryAgents(query: string, maxResults: number = 5) {
  const config = await loadSSMConfig();
  const registryId = config["registry-id"];
  if (!registryId) throw new Error("Registry ID not configured");

  const client = new BedrockAgentCoreClient({ region: AWS_REGION });
  const res = await client.send(
    new SearchRegistryRecordsCommand({
      registryIds: [registryId],
      searchQuery: query,
      maxResults,
    })
  );

  return res.registryRecords || [];
}
