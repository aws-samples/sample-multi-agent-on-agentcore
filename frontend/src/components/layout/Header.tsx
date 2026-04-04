import type { User } from "../../types";
import { LogOut, MessageSquarePlus, Radio, Network } from "lucide-react";

interface HeaderProps {
  user: User | null;
  isAuthenticated: boolean;
  users: Record<string, { name: string; employee_id: string }>;
  onSelectUser: (username: string) => void;
  onLogout: () => void;
  onNewChat: () => void;
  onShowArchitecture: () => void;
}

export function Header({
  user,
  isAuthenticated,
  users,
  onSelectUser,
  onLogout,
  onNewChat,
  onShowArchitecture,
}: HeaderProps) {
  return (
    <header className="h-12 border-b border-border bg-card flex items-center px-4 gap-4 shrink-0">
      {/* Branding */}
      <div className="flex items-center gap-2">
        <Radio className="w-4 h-4 text-primary" />
        <span className="font-display font-bold text-sm tracking-wider text-primary">
          CONCIERGE
        </span>
      </div>

      {/* Architecture button */}
      <button
        onClick={onShowArchitecture}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors border border-border"
        title="View Architecture"
      >
        <Network className="w-3.5 h-3.5" />
        <span>Architecture</span>
      </button>

      <div className="flex-1" />

      {/* User selector / auth */}
      {!isAuthenticated ? (
        <div className="flex items-center gap-2">
          <select
            className="bg-muted text-foreground text-xs rounded px-2 py-1 border border-border outline-none"
            onChange={(e) => onSelectUser(e.target.value)}
            defaultValue=""
          >
            <option value="" disabled>
              Select user...
            </option>
            {Object.entries(users).map(([key, u]) => (
              <option key={key} value={key}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground font-medium">
            {user?.name}
          </span>
          <button
            onClick={onNewChat}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="New Chat"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onLogout}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}
