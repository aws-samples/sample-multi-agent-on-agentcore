"use client";

import { useState, useEffect } from "react";
import { Shield, Trash2, RefreshCw } from "lucide-react";
import { GatewayToolsPanel } from "./GatewayToolsPanel";
import { ToolSearchPanel } from "./ToolSearchPanel";
import { ToolCallPanel } from "./ToolCallPanel";
import { PromptPanel } from "./PromptPanel";

const ADMIN_USERNAME = "alice";

type AdminTab = "registry" | "prompt" | "toolcall";

interface AdminPanelProps {
  currentUsername?: string | null;
  lastUserMessage: string | null;
  sessionId: string | null;
  isStreaming: boolean;
  onResetAll: () => void;
  resetting: boolean;
  confirmReset: boolean;
  onCancelReset: () => void;
}

export function AdminPanel({ currentUsername, lastUserMessage, sessionId, isStreaming, onResetAll, resetting, confirmReset, onCancelReset }: AdminPanelProps) {
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<AdminTab>("registry");

  useEffect(() => {
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USERNAME }),
    })
      .then((r) => r.json())
      .then((data) => setToken(data.token))
      .catch(() => {});
  }, []);

  const tabs: { key: AdminTab; label: string }[] = [
    { key: "registry", label: "Registry" },
    { key: "prompt",   label: "Prompt" },
    { key: "toolcall", label: "Tool Call" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 h-10 border-b border-border shrink-0">
        <Shield className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="font-display font-semibold text-xs text-foreground">
          Admin
        </span>
        <div className="flex-1" />
        {/* Reset All */}
        {confirmReset ? (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-red-400 font-medium">Reset all?</span>
            <button
              onClick={onResetAll}
              disabled={resetting}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors border border-red-500"
            >
              {resetting ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
              Yes
            </button>
            <button
              onClick={onCancelReset}
              className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-muted text-muted-foreground border border-border hover:text-foreground transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={onResetAll}
            disabled={resetting}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium transition-colors border text-red-400 border-red-400/40 hover:bg-red-400/10 disabled:opacity-50"
          >
            <Trash2 className="w-2.5 h-2.5" />
            Reset All
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!token ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[13px] text-muted-foreground">
              Connecting...
            </span>
          </div>
        ) : (
          <>
            {tab === "registry" && (
              <div className="flex flex-col h-full">
                <div className="shrink-0 border-b border-border">
                  <ToolSearchPanel token={token} />
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <GatewayToolsPanel token={token} />
                </div>
              </div>
            )}
            {tab === "prompt"   && (
              <PromptPanel
                lastUserMessage={lastUserMessage}
                sessionId={sessionId}
                username={currentUsername ?? null}
                isStreaming={isStreaming}
              />
            )}
            {tab === "toolcall" && <ToolCallPanel username={currentUsername || null} />}
          </>
        )}
      </div>
    </div>
  );
}
