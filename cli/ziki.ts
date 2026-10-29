#!/usr/bin/env tsx
/**
 * Entry point for `pnpm ziki`. Loads the repo's .env, then runs the command.
 * See cli/run.ts for the commands and docs/cli.md for how to use them.
 */
import { CliEnvironmentError, loadDotEnv } from "./env";
import { EXIT, run } from "./run";

async function main(): Promise<number> {
  try {
    loadDotEnv();
  } catch (error) {
    if (error instanceof CliEnvironmentError) {
      console.error(error.message);
      return EXIT.environment;
    }
    throw error;
  }
  return run(process.argv.slice(2));
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(EXIT.usage);
  },
);
