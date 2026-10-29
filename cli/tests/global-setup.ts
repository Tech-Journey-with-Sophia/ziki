import path from "node:path";
import { loadDotEnv } from "../env";
import { run } from "../run";

/**
 * Before any scenario: the local server and database must be up (fail fast
 * with the reason if not), then the `cli-test` sandbox is rebuilt from
 * scratch with fresh agent keys.
 */
export default async function setup(): Promise<void> {
  loadDotEnv();
  process.env.ZIKI_CLI_SANDBOX = "cli-test";
  process.env.ZIKI_CLI_KEYRING = path.resolve(__dirname, "../../.ziki-cli/test-agents.json");

  const lines: string[] = [];
  const io = { out: (text: string) => lines.push(text), err: (text: string) => lines.push(text) };
  if ((await run(["setup", "--reset"], io)) !== 0) {
    throw new Error(`CLI tests need a local database and server.\n${lines.join("\n")}`);
  }
  if ((await run(["doctor"], io)) !== 0) {
    throw new Error(`CLI tests need the local server running (\`pnpm dev\`).\n${lines.join("\n")}`);
  }
}
