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
import { apiError, CliError, usageError } from "../errors.ts";

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
      try {
        await Client.withKey(base, key).me();
      } catch (err) {
        // A connection failure here usually means the URL is wrong, not the
        // key — most often a self-hoster who forgot `--url`. Point both kinds
        // of user at the fix instead of surfacing a bare "fetch failed".
        if (
          err instanceof CliError &&
          err.kind === "api" &&
          err.message.includes("could not reach the server")
        ) {
          throw apiError(
            `couldn't reach a litedrop server at ${base}.\n` +
              `  • Hosted service: litedrop login --url https://app.litedrop.dev\n` +
              `  • Self-hosting: litedrop login --url <your-server-url>`,
          );
        }
        throw err;
      }

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
