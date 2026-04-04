export interface User {
  username: string;
  name: string;
  employee_id: string;
}

export interface AuthState {
  currentUser: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  agentName: string;
  input?: Record<string, unknown>;
  isActive: boolean;
  timestamp: number;
}

export interface Notification {
  id: string;
  message: string;
  agent?: string;
  timestamp: number;
  type: "info" | "error";
}

export interface SSEEvent {
  type: "tool_use" | "tool_result" | "text" | "error" | "done";
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

export interface ConfigResponse {
  users: Record<string, { name: string; employee_id: string }>;
  has_runtime: boolean;
  region: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}
