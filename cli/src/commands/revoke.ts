import type { Command } from "commander";
import { Client } from "../api/client.ts";
import { resolveConfig } from "../config.ts";
import { CliError, notFoundError } from "../errors.ts";
import { stripControl } from "../term.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `revoke` deletes a share and confirms on stderr. The API deletes by id, so
// an id-shaped target goes straight to DELETE; a slug is resolved by scanning
// the caller's shares first.
export function registerRevoke(program: Command): void {
  program
    .command("revoke")
    .description("Revoke a share by id or slug.")
    .argument("<target>", "Share id or slug to revoke.")
    .action(async (target: string) => {
      const client = Client.fromConfig(resolveConfig());
      if (UUID_RE.test(target)) {
        try {
          await client.deleteShare(target);
        } catch (err) {
          if (err instanceof CliError && err.kind === "notFound") {
            throw notFoundError(`no share matching '${target}'`);
          }
          throw err;
        }
        process.stderr.write(`revoked ${target}\n`);
        return;
      }
      const share = await client.resolve(target);
      await client.deleteShare(share.id);
      process.stderr.write(
        `revoked ${stripControl(share.slug)} (${stripControl(share.filename)})\n`,
      );
    });
}
