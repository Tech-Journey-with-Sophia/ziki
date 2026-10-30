import { AgentAvatar } from "@/components/agent-avatar";

export interface AgentStatusAvatarProps {
  agentId: string;
  avatar?: string | null;
  name?: string;
  status?: string | null;
  recent?: boolean;
  revoked?: boolean;
  size?: number;
  className?: string;
}

/**
 * Maps agent signals to awake vs sleeping status:
 * - Active / recent activity -> awake
 * - Inactive / offline / revoked -> sleeping
 */
export function isAgentAwake({
  status,
  recent,
  revoked = false,
}: {
  status?: string | null;
  recent?: boolean;
  revoked?: boolean;
}): boolean {
  if (revoked) return false;
  if (status) {
    return status === "working" || status === "waiting" || status === "idle";
  }
  return Boolean(recent);
}

export function AgentStatusAvatar({
  agentId,
  avatar = null,
  name,
  status,
  recent,
  revoked = false,
  size = 40,
  className = "",
}: AgentStatusAvatarProps) {
  const awake = isAgentAwake({ status, recent, revoked });
  const statusLabel = awake ? "Awake · Active" : "Sleeping · Inactive";
  const badgeSize = Math.max(9, Math.round(size * 0.28));

  return (
    <div
      data-testid="agent-status-avatar"
      data-status={awake ? "awake" : "sleeping"}
      title={name ? `${name} (${statusLabel})` : statusLabel}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
    >
      <AgentAvatar
        agentId={agentId}
        avatar={avatar}
        size={size}
        sleeping={!awake}
      />
      {/* Animated status badge */}
      <span
        aria-hidden="true"
        style={{ width: `${badgeSize}px`, height: `${badgeSize}px` }}
        className={`absolute bottom-0 right-0 flex items-center justify-center rounded-full border-2 border-zk-surface shadow-xs ${
          awake ? "bg-emerald-500" : "bg-slate-400"
        }`}
      >
        {awake ? (
          <span className="h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping motion-reduce:animate-none" />
        ) : null}
      </span>
      {/* Screen-reader accessible announcement */}
      <span className="sr-only">
        {name ? `${name}: ` : ""}
        {awake ? "Awake (recently active)" : "Sleeping (inactive)"}
      </span>
    </div>
  );
}
