import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./env";

/**
 * Agent keys the CLI may act with, kept in `.ziki-cli/agents.json` (git-ignored).
 * `pnpm ziki setup` fills it with the local sandbox's agents; each entry is a
 * key to the local server only.
 */
export type KeyringAgent = {
  name: string;
  agentId: string;
  key: string;
  level: "working" | "manager" | "merger";
  ownerEmail: string;
  projectId: string;
};

export type Keyring = { serverUrl: string; current: string | null; agents: Record<string, KeyringAgent> };

export function keyringPath(): string {
  return process.env.ZIKI_CLI_KEYRING ?? path.join(REPO_ROOT, ".ziki-cli", "agents.json");
}

export function readKeyring(): Keyring {
  const file = keyringPath();
  if (!existsSync(file)) return { serverUrl: "", current: null, agents: {} };
  return JSON.parse(readFileSync(file, "utf8")) as Keyring;
}

export function writeKeyring(keyring: Keyring): void {
  const file = keyringPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(keyring, null, 2)}\n`, { mode: 0o600 });
}

/** The agent to act as: `--as`, then the keyring's current agent. */
export function resolveAgent(keyring: Keyring, name: string | undefined): KeyringAgent {
  const wanted = name ?? keyring.current ?? undefined;
  if (!wanted) {
    throw new Error("No agent chosen. Run `pnpm ziki setup`, then pass --as <agent> or `pnpm ziki use <agent>`.");
  }
  const agent = keyring.agents[wanted];
  if (!agent) {
    const known = Object.keys(keyring.agents);
    throw new Error(
      known.length
        ? `No agent "${wanted}" in the keyring. Known: ${known.join(", ")}.`
        : "The keyring is empty. Run `pnpm ziki setup` first.",
    );
  }
  return agent;
}
