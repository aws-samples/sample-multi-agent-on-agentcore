"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useChat } from "@/hooks/useChat";
import { useNotifications } from "@/hooks/useNotifications";
import { Header } from "@/components/layout/Header";
import { NotificationBar } from "@/components/layout/NotificationBar";
import { ArchitectureModal } from "@/components/layout/ArchitectureModal";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DataPanel } from "@/components/visualization/DataPanel";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { MemoryPanel } from "@/components/admin/MemoryPanel";
import type { ConfigResponse } from "@/types";

export default function Home() {
  const auth = useAuth();
  const { notifications, addNotification } = useNotifications();

  const stableAddNotification = useCallback(
    (msg: string, agent?: string, type?: "info" | "error") => {
      addNotification(msg, agent, type);
    },
    [addNotification]
  );

  const chat = useChat(
    auth.token,
    auth.currentUser?.username || null,
    stableAddNotification,
  );

  const [users, setUsers] = useState<
    Record<string, { name: string; employee_id: string }>
  >({});

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: ConfigResponse) => {
        setUsers(data.users);
      })
      .catch(() => {
        setUsers({
          alice: { name: "Alice Johnson", employee_id: "EMP-001" },
          bob: { name: "Bob Williams", employee_id: "EMP-002" },
          charlie: { name: "Charlie Davis", employee_id: "EMP-003" },
        });
      });
  }, []);

  const handleSelectUser = useCallback(
    async (username: string) => {
      try {
        await auth.login(username);
        addNotification(`Logged in as ${username}`, undefined, "info");
      } catch {
        // error handled in useAuth
      }
    },
    [auth, addNotification]
  );

  const handleLogout = useCallback(() => {
    auth.logout();
    chat.clearChat();
    addNotification("Logged out", undefined, "info");
  }, [auth, chat, addNotification]);

  const [tab, setTab] = useState<"chat" | "data">("chat");
  const [showArchitecture, setShowArchitecture] = useState(false);

  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const handleResetAll = useCallback(async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    setResetting(true);
    try {
      const userKeys = Object.keys(users);
      await Promise.allSettled([
        fetch("/api/toolcalls", { method: "DELETE" }),
        ...userKeys.map((u) =>
          fetch(`/api/memory?user=${u}`, { method: "DELETE" })
        ),
      ]);
      chat.clearChat();
      addNotification("All data reset successfully", undefined, "info");
    } catch {
      addNotification("Reset failed (partial data may remain)", undefined, "error");
    } finally {
      setResetting(false);
    }
  }, [confirmReset, users, chat, addNotification]);

  return (
    <div className="h-screen w-screen flex items-center bg-[hsl(220,20%,92%)] gap-5 px-5">
      {/* Chat panel */}
      <div className="flex-1 min-w-0 h-[92vh] flex flex-col bg-background rounded-2xl border border-border overflow-hidden shadow-2xl">
        <Header
          user={auth.currentUser}
          isAuthenticated={auth.isAuthenticated}
          users={users}
          onSelectUser={handleSelectUser}
          onLogout={handleLogout}
          onNewChat={chat.clearChat}
          onShowArchitecture={() => setShowArchitecture(true)}
        />

        {/* Tab bar */}
        {auth.isAuthenticated && (
          <div className="flex border-b border-border shrink-0">
            <button
              onClick={() => setTab("chat")}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === "chat"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setTab("data")}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                tab === "data"
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Data
            </button>
          </div>
        )}

        {/* Chat / Data content */}
        <div className="flex-1 min-h-0 relative">
          <div className={tab === "chat" ? "h-full" : "hidden"}>
            <ChatPanel
              messages={chat.messages}
              activeToolCalls={chat.activeToolCalls}
              isStreaming={chat.isStreaming}
              isAuthenticated={auth.isAuthenticated}
              userName={auth.currentUser?.name || null}
              onSend={chat.sendMessage}
            />
          </div>
          <div className={tab === "data" ? "h-full" : "hidden"}>
            <DataPanel username={auth.currentUser?.username || null} />
          </div>
        </div>

        <NotificationBar notifications={notifications} />
      </div>

      {/* Admin panel */}
      <div className="flex-1 min-w-0 h-[92vh] bg-background rounded-2xl border border-border overflow-hidden shadow-2xl">
        <AdminPanel
          currentUsername={auth.currentUser?.username || null}
          lastUserMessage={chat.lastUserMessage}
          sessionId={chat.sessionId}
          isStreaming={chat.isStreaming}
          onResetAll={handleResetAll}
          resetting={resetting}
          confirmReset={confirmReset}
          onCancelReset={() => setConfirmReset(false)}
        />
      </div>

      {/* Memory panel */}
      <div className="flex-1 min-w-0 h-[92vh] bg-background rounded-2xl border border-border overflow-hidden shadow-2xl">
        <MemoryPanel users={users} currentUsername={auth.currentUser?.username || null} />
      </div>

      {/* Architecture Modal */}
      <ArchitectureModal
        isOpen={showArchitecture}
        onClose={() => setShowArchitecture(false)}
      />
    </div>
  );
}
