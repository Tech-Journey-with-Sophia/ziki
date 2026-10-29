"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AgentLevel } from "@prisma/client";
import { AGENT_LEVEL_LABELS } from "@/lib/agents/levels";
import { agentPageHref } from "@/lib/header-nav";
import { useToast } from "@/components/ui/toast";
import { setAgentLevelAction } from "@/app/(app)/settings/agents/actions";
import { renameAgentAction } from "./actions";
import {
  agentsInputClass,
  agentsLabelClass,
  agentsSecondaryBtn,
} from "@/app/(app)/settings/agents/agents-ui";

/**
 * Rename the agent and change its level from its page. A new name moves the
 * page to the new address; a level the viewer may not set is shown but disabled.
 */
export function AgentSettingsForm({
  agentId,
  name,
  level,
  levels,
}: {
  agentId: string;
  name: string;
  level: AgentLevel;
  /** The levels this viewer may set. */
  levels: AgentLevel[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState(name);
  const [current, setCurrent] = useState(level);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const renamed = draft.trim() !== name;

  function rename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renamed) return;
    startTransition(async () => {
      const result = await renameAgentAction(agentId, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      toast(`Renamed to ${result.name}.`, "success");
      router.replace(agentPageHref(result.name));
    });
  }

  function changeLevel(next: AgentLevel) {
    const previous = current;
    setCurrent(next);
    startTransition(async () => {
      const result = await setAgentLevelAction(agentId, next);
      if (!result.ok) {
        setCurrent(previous);
        toast(result.error, "error");
        return;
      }
      toast(`${name} is now a ${AGENT_LEVEL_LABELS[next].toLowerCase()}.`, "success");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
      <form onSubmit={rename} className="space-y-1.5">
        <label htmlFor={`agent-name-${agentId}`} className={agentsLabelClass}>
          Name
        </label>
        <div className="flex gap-2">
          <input
            id={`agent-name-${agentId}`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            disabled={pending}
            required
            className={agentsInputClass}
          />
          <button type="submit" disabled={pending || !renamed || !draft.trim()} className={agentsSecondaryBtn}>
            Save
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm font-semibold text-zk-bad-fg">
            {error}
          </p>
        ) : null}
      </form>
      <div className="space-y-1.5">
        <label htmlFor={`agent-level-${agentId}`} className={agentsLabelClass}>
          Level
        </label>
        <select
          id={`agent-level-${agentId}`}
          value={current}
          disabled={pending}
          onChange={(event) => changeLevel(event.target.value as AgentLevel)}
          className={`${agentsInputClass} min-w-[10rem]`}
        >
          {[...new Set([current, ...levels])].map((option) => (
            <option key={option} value={option} disabled={!levels.includes(option)}>
              {AGENT_LEVEL_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
