import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The CLI is for a developer's machine only. It talks to a Ziki server running
 * locally and, for `setup`, writes to the local database. Anything that points
 * somewhere else — production, staging, a teammate's box — is refused before a
 * single request is made.
 */

export const REPO_ROOT = path.resolve(__dirname, "..");
export const DEFAULT_URL = "http://localhost:3001";

/** The variables the guards read; `process.env` by default. */
export type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class CliEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliEnvironmentError";
  }
}

/** Loads `.env` from the repo root once, without overriding variables already set. */
export function loadDotEnv(root = REPO_ROOT): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) {
    throw new CliEnvironmentError(
      "No .env found in the repo root. Copy .env.example to .env and point DATABASE_URL at your local database.",
    );
  }
  const before = { ...process.env };
  process.loadEnvFile(file);
  // Variables set in the shell win over .env.
  for (const [key, value] of Object.entries(before)) process.env[key] = value;
}

export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith(".localhost");
}

/** The local database URL, or a clear refusal. */
export function localDatabaseUrl(env: Env = process.env): string {
  const raw = env.DATABASE_URL?.trim().replace(/^["']|["']$/g, "");
  if (!raw) throw new CliEnvironmentError("DATABASE_URL is not set. The CLI needs a local database.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliEnvironmentError("DATABASE_URL is not a valid URL.");
  }
  if (!isLocalHost(url.hostname)) {
    throw new CliEnvironmentError(
      `DATABASE_URL points at ${url.hostname}, not a local database. The CLI only runs against a database on this machine.`,
    );
  }
  const prod = env.DATABASE_URL_PROD?.trim().replace(/^["']|["']$/g, "");
  if (prod && prod === raw) {
    throw new CliEnvironmentError("DATABASE_URL is the same as DATABASE_URL_PROD. Refusing to run.");
  }
  return raw;
}

/** The local server URL (`--server`, then ZIKI_CLI_URL, then localhost:3001), or a clear refusal. */
export function localServerUrl(explicit?: string, env: Env = process.env): string {
  const raw = (explicit ?? env.ZIKI_CLI_URL ?? DEFAULT_URL).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CliEnvironmentError(`${raw} is not a valid URL.`);
  }
  if (!isLocalHost(url.hostname)) {
    throw new CliEnvironmentError(
      `${url.origin} is not a local server. The CLI only talks to Ziki running on this machine (for example ${DEFAULT_URL}).`,
    );
  }
  return url.origin;
}
