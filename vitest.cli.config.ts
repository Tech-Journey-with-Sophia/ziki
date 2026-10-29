import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * CLI scenario tests (`pnpm test:cli`): drive `pnpm ziki` against the LOCAL
 * server and database, end to end. They need `pnpm dev` (or `pnpm start`)
 * running and `docker compose up -d`; they fail fast with the reason if not.
 * They run in their own sandbox workspace, `cli-test`, rebuilt every run.
 * See docs/cli.md.
 */
export default defineConfig({
  test: {
    include: ["cli/tests/**/*.scenario.ts"],
    environment: "node",
    globalSetup: ["cli/tests/global-setup.ts"],
    // One server, one sandbox: scenarios run one after another.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
    env: {
      ZIKI_CLI_SANDBOX: "cli-test",
      ZIKI_CLI_KEYRING: path.resolve(__dirname, ".ziki-cli/test-agents.json"),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "cli/shims/server-only.ts"),
    },
  },
});
