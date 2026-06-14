import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { Client } from "../api/client.ts";
import { resolveConfig } from "../config.ts";
import { ioError, usageError } from "../errors.ts";
import { stripControl } from "../term.ts";

interface PushOptions {
  name?: string;
  expires?: string;
  password?: string;
  maxViews?: string;
  json?: boolean;
}

// `push` is the agent-friendly core: stdout is the URL and nothing else (logs
// go to stderr), so `URL=$(litedrop push x.md)` just works. `--json` swaps the
// single URL line for the full share object.
export function registerPush(program: Command): void {
  program
    .command("push")
    .description("Upload a file (or stdin) and print the share URL.")
    .argument("<file>", "File to upload, or - to read from stdin.")
    .option(
      "--name <name>",
      "Override the filename (required when reading from stdin).",
    )
    .option(
      "--expires <when>",
      "1h|24h|7d|30d|never, <n>h/<n>d, or an ISO-8601 timestamp (default 7d).",
    )
    .option(
      "--password <password>",
      "Password-protect the link. Prefer LITEDROP_PASSWORD — flag values land in shell history.",
    )
    .option("--max-views <n>", "Burn the link after N views.")
    .option(
      "--json",
      "Emit the full share object as JSON instead of just the URL.",
    )
    .action(async (file: string, opts: PushOptions) => {
      const { bytes, name } = await readInput(file, opts.name);

      const envPassword = process.env.LITEDROP_PASSWORD;
      const password =
        opts.password ??
        (envPassword && envPassword.length > 0 ? envPassword : undefined);

      const client = Client.fromConfig(resolveConfig());
      const share = await client.createShare(name, bytes, {
        expires: parseExpires(opts.expires),
        password,
        maxViews: parseMaxViews(opts.maxViews),
      });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(share)}\n`);
      } else {
        process.stdout.write(`${stripControl(share.url)}\n`);
      }
    });
}

function parseMaxViews(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // Plain digits only — Number() alone would also admit hex, exponents, and
  // whitespace.
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    throw usageError(
      `invalid value '${raw}' for --max-views: expected a positive integer`,
    );
  }
  return Number(raw);
}

// Shape-check locally so a typo fails before the upload; the server stays the
// authority on what the values mean.
function parseExpires(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === "never" || /^\d+[hd]$/.test(raw)) return raw;
  if (!Number.isNaN(Date.parse(raw))) return raw;
  throw usageError(
    `invalid value '${raw}' for --expires: expected <n>h, <n>d, never, or an ISO-8601 timestamp`,
  );
}

async function readInput(
  file: string,
  name: string | undefined,
): Promise<{ bytes: Uint8Array; name: string }> {
  if (file === "-") {
    if (!name) throw usageError("--name is required when reading from stdin");
    return { bytes: await readStdin(), name };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(file);
  } catch (err) {
    throw ioError(`${file}: ${(err as Error).message}`);
  }
  const resolved = name ?? basename(file);
  if (!resolved) throw usageError("could not infer a filename; pass --name");
  return { bytes, name: resolved };
}

async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
