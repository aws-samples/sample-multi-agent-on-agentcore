import type { Notification } from "../../types";
import { cn } from "../../lib/utils";
import { getAgentColor } from "../../lib/constants";

interface NotificationBarProps {
  notifications: Notification[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function NotificationBar({ notifications }: NotificationBarProps) {
  if (notifications.length === 0) {
    return (
      <footer className="h-8 border-t border-border bg-card flex items-center px-4 shrink-0">
        <span className="text-[11px] font-mono text-muted-foreground">
          Awaiting input...
        </span>
      </footer>
    );
  }

  // Show recent notifications as a scrolling ticker
  const items = notifications.slice(-20);
  const duplicated = [...items, ...items]; // for seamless loop

  return (
    <footer className="h-8 border-t border-border bg-card flex items-center overflow-hidden shrink-0">
      <div className="flex items-center gap-6 animate-ticker whitespace-nowrap px-4">
        {duplicated.map((n, i) => {
          const colorClass = n.agent ? getAgentColor(n.agent) : undefined;
          return (
            <span
              key={`${n.id}-${i}`}
              className={cn(
                "text-[11px] font-mono",
                n.type === "error"
                  ? "text-red-400"
                  : colorClass
                    ? `text-${colorClass}`
                    : "text-muted-foreground"
              )}
            >
              [{formatTime(n.timestamp)}] {n.message}
            </span>
          );
        })}
      </div>
    </footer>
  );
}
