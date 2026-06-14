#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerLogin } from "./commands/login.ts";
import { registerLogout } from "./commands/logout.ts";
import { registerLs } from "./commands/ls.ts";
import { registerOpen } from "./commands/open.ts";
import { registerPush } from "./commands/push.ts";
import { registerRevoke } from "./commands/revoke.ts";
import { CliError } from "./errors.ts";
import { configureProxyFromEnv } from "./proxy.ts";
import { stripControl } from "./term.ts";
// Generated from package.json by scripts/gen-version.mjs; surfaced via `--version`.
import { VERSION } from "./version.ts";

async function main(): Promise<void> {
  await configureProxyFromEnv();

  const program = new Command();
  program
    .name("litedrop")
    .description("Share markdown/HTML via a link. CLI-first.")
    .version(VERSION)
    // Throw instead of calling process.exit, so we own every exit code.
    .exitOverride()
    .showHelpAfterError();

  registerLogin(program);
  registerLogout(program);
  registerPush(program);
  registerLs(program);
  registerRevoke(program);
  registerOpen(program);

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  // Our own typed failures carry the deterministic exit code.
  if (err instanceof CliError) {
    // Messages can embed server-supplied text — keep it terminal-safe.
    process.stderr.write(`error: ${stripControl(err.message)}\n`);
    process.exitCode = err.exitCode;
    return;
  }
  // Commander's own outcomes: --help / --version are successful exits; argument
  // and unknown-command problems are usage errors (exit 2). The message was
  // already written by commander.
  if (err instanceof CommanderError) {
    const ok =
      err.code === "commander.help" ||
      err.code === "commander.helpDisplayed" ||
      err.code === "commander.version";
    process.exitCode = ok ? 0 : 2;
    return;
  }
  process.stderr.write(
    `error: ${stripControl(err instanceof Error ? err.message : String(err))}\n`,
  );
  process.exitCode = 1;
});
