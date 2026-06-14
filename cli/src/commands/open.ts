import type { Command } from "commander";
import { Client } from "../api/client.ts";
import { resolveConfig } from "../config.ts";
import { stripControl } from "../term.ts";

// Prints the share URL to stdout (pipe it to a browser opener if you like).
export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("Print the URL for a share by id or slug.")
    .argument("<target>", "Share id or slug.")
    .action(async (target: string) => {
      const client = Client.fromConfig(resolveConfig());
      const share = await client.resolve(target);
      process.stdout.write(`${stripControl(share.url)}\n`);
    });
}
