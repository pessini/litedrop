import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import type { Command } from "commander";
import { Client } from "../api/client.ts";
import {
  DEFAULT_BASE_URL,
  envNonEmpty,
  loadFileConfig,
  saveFileConfig,
  stripTrailingSlash,
} from "../config.ts";
import { usageError } from "../errors.ts";

// `login` stores an API key after validating it against the server.
export function registerLogin(program: Command): void {
  program
    .command("login")
    .description("Store an API key (validated against the server).")
    .option(
      "--key <key>",
      "API key (ld_live_…). Prefer the prompt or LITEDROP_API_KEY — flag values land in shell history.",
    )
    .option(
      "--url <url>",
      "Base URL of the litedrop server (persisted to config).",
    )
    .action(async (opts: { key?: string; url?: string }) => {
      const fc = loadFileConfig();
      const explicitUrl = opts.url ? stripTrailingSlash(opts.url) : undefined;
      if (explicitUrl) fc.base_url = explicitUrl;
      // Same precedence every other command uses, with the explicit flag on
      // top: --url, then the env override, then the stored base.
      const base =
        explicitUrl ??
        stripTrailingSlash(
          envNonEmpty("LITEDROP_API_URL") ?? fc.base_url ?? DEFAULT_BASE_URL,
        );

      const key =
        (opts.key && opts.key.length > 0 ? opts.key : undefined) ??
        envNonEmpty("LITEDROP_API_KEY") ??
        (await promptKey());

      // Validate before persisting, so we never store a dead token.
      await Client.withKey(base, key).me();

      fc.api_key = key;
      saveFileConfig(fc);
      process.stderr.write(`Logged in (${base})\n`);
    });
}

async function promptKey(): Promise<string> {
  // Readline echoes input to its output stream; send that echo to a sink so
  // the key isn't shown while it's typed. The prompt itself goes to stderr.
  const sink = new Writable({ write: (_chunk, _enc, cb) => cb() });
  const isTty = process.stdin.isTTY === true;
  process.stderr.write("Enter API key: ");
  const rl = createInterface({
    input: process.stdin,
    output: sink,
    terminal: isTty,
  });
  try {
    const answer = await new Promise<string>((resolve) =>
      rl.question("", resolve),
    );
    if (isTty) process.stderr.write("\n");
    const key = answer.trim();
    if (!key) throw usageError("no API key provided");
    return key;
  } finally {
    rl.close();
  }
}
