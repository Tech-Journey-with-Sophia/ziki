import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { loadDotEnv } from "../env";
import { run } from "../run";

loadDotEnv();

export type Agent = "ada" | "bob" | "cara" | "dana" | "eli";

/** API responses vary per route, so scenarios read them loosely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export type CliResult = { code: number; out: string; err: string; json: Json };

/** Runs `pnpm ziki <args>` in-process: the same parsing, HTTP calls and output as the terminal. */
export async function ziki(...args: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (text) => out.push(text), err: (text) => err.push(text) });
  const text = out.join("\n");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { code, out: text, err: err.join("\n"), json };
}

/** Runs a command as `agent` and expects it to succeed. */
export async function ok(agent: Agent, command: string, flags: Record<string, string | number | boolean | string[]> = {}): Promise<Json> {
  const result = await ziki(command, ...toArgs(flags), "--as", agent);
  expect(result.code, `${command} as ${agent} failed:\n${result.err}\n${result.out}`).toBe(0);
  return result.json;
}

/** Runs a command as `agent` and expects the API to refuse it with `status`. */
export async function refused(
  agent: Agent,
  command: string,
  flags: Record<string, string | number | boolean | string[]>,
  status: number,
): Promise<Json> {
  const result = await ziki(command, ...toArgs(flags), "--as", agent);
  expect(result.code, `${command} as ${agent} should have been refused:\n${result.out}`).toBe(1);
  expect(result.json?.status, `${command} as ${agent}: ${JSON.stringify(result.json?.body)}`).toBe(status);
  return result.json.body;
}

function toArgs(flags: Record<string, string | number | boolean | string[]>): string[] {
  return Object.entries(flags).flatMap(([key, value]) => [
    `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
    Array.isArray(value) ? value.join(",") : String(value),
  ]);
}

let counter = 0;
/** A title unique to this run, so scenarios never trip over each other's issues. */
export function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}${(counter++).toString(36)}`;
}

/** Files a fresh issue as `agent` and returns its id. */
export async function fileIssue(agent: Agent, label: string): Promise<string> {
  // Scenario titles look alike on purpose, so skip the similar-title check (tested on its own).
  const created = await ok(agent, "create-issue", {
    title: unique(label),
    description: "Steps: open the page and press Save. Expected: it saves. Actual: nothing happens.",
    idempotencyKey: randomUUID(),
    acknowledgeSimilar: true,
  });
  return created.issue.id as string;
}

/** Confirms an issue the way the workflow needs: two independent real-accepts and a duplicate clearance. */
export async function confirm(id: string, reviewers: [Agent, Agent], triager: Agent): Promise<void> {
  for (const agent of reviewers) await ok(agent, "validate-issue", { id, kind: "real", verdict: "accept", severity: "high" });
  const cleared = await ok(triager, "validate-issue", { id, kind: "duplicate", verdict: "reject" });
  expect(cleared.confirmed).toBe(true);
}
