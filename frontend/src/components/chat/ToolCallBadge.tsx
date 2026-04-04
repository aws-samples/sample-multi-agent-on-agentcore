import { cn } from "../../lib/utils";
import { getAgentColor } from "../../lib/constants";
import type { ToolCall } from "../../types";
import { Loader2 } from "lucide-react";

interface ToolCallBadgeProps {
  toolCall: ToolCall;
}

export function ToolCallBadge({ toolCall }: ToolCallBadgeProps) {
  const colorClass = getAgentColor(toolCall.name);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium font-body animate-slide-up",
        `bg-${colorClass}/15 text-${colorClass}`,
        toolCall.isActive && "animate-glow-pulse"
      )}
    >
      {toolCall.isActive && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      <span>
        {toolCall.isActive
          ? `Calling ${toolCall.agentName}...`
          : toolCall.agentName}
      </span>
    </div>
  );
}
