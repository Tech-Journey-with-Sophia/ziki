"use client";

import { useState } from "react";
import Link from "next/link";
import type { AgentLevel } from "@prisma/client";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { agentPageHref } from "@/lib/header-nav";
import { AgentStatusAvatar } from "@/components/agent-status-avatar";
import { LocalTime } from "@/components/local-time";
import { RelativeTime } from "@/components/relative-time";
import { AgentControls } from "./agent-controls";
import { AgentRowKey } from "./agent-row-key";
import type { AgentProjectChoice } from "./create-agent-form";
import {
  agentsMutedClass,
  agentsSurface,
  levelBadgeClass,
} from "./agents-ui";

export type ManageAgentItem = {
  id: string;
  name: string;
  model: string | null;
  level: AgentLevel;
  burst: boolean;
  burstUntil: string | null;
  createdAt: string;
  revokedAt: string | null;
  personal: boolean;
  /** The owner's avatar pick; null wears the automatic robot. */
  avatar: string | null;
  currentProjectId: string | null;
  recent: boolean;
  apiKeys: {
    id: string;
    prefix: string;
    apiKey: string | null;
    projectId: string | null;
    projectName: string | null;
    lastUsedAt: string | null;
  }[];
};

export function ManageAgentsList({
  agents,
  activeCount,
  maxActive,
  levels,
  projects,
  now,
  canSetBurst,
}: {
  agents: ManageAgentItem[];
  activeCount: number;
  maxActive: number;
  levels: AgentLevel[];
  projects: AgentProjectChoice[];
  now: string;
  canSetBurst: boolean;
}) {
  const [query, setQuery] = useState("");

  const visible = agents.filter((agent) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      agent.name.toLowerCase().includes(q) ||
      (agent.model?.toLowerCase().includes(q) ?? false) ||
      AGENT_LEVEL_LABELS[agent.level].toLowerCase().includes(q)
    );
  });

  const meterPct = Math.min(100, Math.round((activeCount / Math.max(maxActive, 1)) * 100));
  const legacyCount = agents.reduce(
    (count, agent) => count + agent.apiKeys.filter((key) => !key.apiKey).length,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`${agentsSurface} p-4`}>
          <p className="text-xs font-bold uppercase tracking-[0.06em] text-zk-muted">Active agents</p>
          <p className="mt-1 text-2xl font-extrabold text-zk-text">
            {activeCount} <span className="text-base font-semibold text-zk-muted">/ {maxActive}</span>
          </p>
          <p className="mt-0.5 text-xs text-zk-muted">limit {maxActive}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zk-seg">
            <div
              className="h-full rounded-full bg-electric-blue-strong transition-[width] duration-300"
              style={{ width: `${meterPct}%` }}
            />
          </div>
        </div>
      </div>

      {legacyCount > 0 ? (
        <div className="rounded-[20px] border border-zk-warn-bd bg-zk-warn-bg/50 px-4 py-3 text-sm text-zk-warn-fg">
          <p className="font-bold">
            {legacyCount} {legacyCount === 1 ? "key" : "keys"} can&apos;t be copied
          </p>
          <p className="mt-0.5 text-xs">
            They were issued before keys could be copied again. Regenerate a key to get a copyable one — the new key
            stays on the same row.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Search agents</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            className="h-11 w-full rounded-full border border-zk-border bg-zk-surface px-4 text-sm text-zk-text placeholder:text-zk-muted focus:border-electric-blue focus:outline-none focus:ring-2 focus:ring-electric-blue/20"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <p className={`${agentsMutedClass} ${agentsSurface} p-6`}>
          {agents.length === 0 ? "No agents yet." : "No agents match your search."}
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {visible.map((agent) => {
            const lastUsed = agent.apiKeys.find((key) => key.lastUsedAt)?.lastUsedAt ?? null;
            return (
              // The name's link is stretched over the card, so a click anywhere opens the
              // agent's page; the key and controls sit above it and keep their own clicks.
              <li
                key={agent.id}
                className={`${agentsSurface} group relative flex flex-col gap-4 p-4 transition hover:border-electric-blue/50 hover:shadow-[0_10px_28px_rgba(11,23,51,0.10)] sm:p-5`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="relative shrink-0">
                    <AgentStatusAvatar
                      agentId={agent.id}
                      avatar={agent.avatar}
                      name={agent.name}
                      recent={agent.recent}
                      revoked={Boolean(agent.revokedAt)}
                      size={56}
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link
                      href={agentPageHref(agent.name)}
                      className="block break-words text-base font-extrabold text-zk-text after:absolute after:inset-0 after:rounded-[20px] after:content-[''] hover:text-zk-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-electric-blue"
                    >
                      {agent.name}
                      {agent.personal ? <span className="font-normal text-zk-muted"> · personal</span> : null}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={levelBadgeClass(agent.level)}>{AGENT_LEVEL_LABELS[agent.level]}</span>
                      {agent.revokedAt ? (
                        <span className="inline-flex items-center rounded-full bg-zk-bad-bg px-2.5 py-0.5 text-xs font-bold text-zk-bad-fg">
                          Revoked
                        </span>
                      ) : null}
                      {agent.model ? <span className="text-sm text-zk-muted">{agent.model}</span> : null}
                    </div>
                    <p className="text-xs text-zk-muted">
                      {agent.revokedAt ? (
                        <>
                          Revoked <LocalTime date={agent.revokedAt} />
                        </>
                      ) : agent.apiKeys.length === 0 ? (
                        <>
                          No key · Added <LocalTime date={agent.createdAt} />
                        </>
                      ) : (
                        <>
                          {lastUsed ? (
                            <>
                              Last used <RelativeTime date={lastUsed} />
                            </>
                          ) : (
                            <>Never used</>
                          )}
                          {" · "}
                          Added <LocalTime date={agent.createdAt} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {!agent.revokedAt && agent.apiKeys.length ? (
                  <div className="relative z-10 space-y-1.5">
                    {agent.apiKeys.map((key) => (
                      <AgentRowKey
                        key={key.id}
                        apiKey={key.apiKey}
                        prefix={key.prefix}
                        projectId={key.projectId}
                        projectName={key.projectName}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="relative z-10 mt-auto border-t border-zk-divider pt-4">
                  {agent.revokedAt ? (
                    <AgentControls
                      revoked
                      personal={agent.personal}
                      agentId={agent.id}
                      agentName={agent.name}
                      level={agent.level}
                      levels={levels}
                      projects={projects}
                      now={now}
                    />
                  ) : (
                    <AgentControls
                      personal={agent.personal}
                      agentId={agent.id}
                      agentName={agent.name}
                      level={agent.level}
                      levels={levels}
                      projects={projects}
                      currentProjectId={agent.currentProjectId}
                      burst={agent.burst}
                      burstUntil={agent.burstUntil}
                      now={now}
                      canSetBurst={canSetBurst}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
