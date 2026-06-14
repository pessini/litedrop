import type { Command } from "commander";
import { Client } from "../api/client.ts";
import { resolveConfig } from "../config.ts";
import { stripControl } from "../term.ts";

type Row = [
  slug: string,
  status: string,
  views: string,
  expires: string,
  name: string,
];

// `ls` prints a column-aligned table to stdout, or the raw array with `--json`.
export function registerLs(program: Command): void {
  program
    .command("ls")
    .description("List your shares.")
    .option("--json", "Emit the shares as a JSON array.")
    .action(async (opts: { json?: boolean }) => {
      const client = Client.fromConfig(resolveConfig());
      const shares = await client.listShares();

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(shares)}\n`);
        return;
      }

      if (shares.length === 0) {
        process.stderr.write(
          "no shares yet — `litedrop push <file>` to make one\n",
        );
        return;
      }

      const header: Row = ["SLUG", "STATUS", "VIEWS", "EXPIRES", "NAME"];
      const rows: Row[] = shares.map((s) => [
        stripControl(s.slug),
        stripControl(s.status),
        s.max_views !== null
          ? `${s.view_count}/${s.max_views}`
          : `${s.view_count}`,
        stripControl(s.expires_at ?? "never"),
        stripControl(s.filename),
      ]);

      // Size each column to its widest value so long entries don't shift the
      // columns after them; NAME is last and left unpadded.
      const all = [header, ...rows];
      const width = (i: number): number =>
        Math.max(...all.map((r) => (r[i] as string).length));
      const [w0, w1, w2, w3] = [width(0), width(1), width(2), width(3)];
      for (const r of all) {
        process.stdout.write(
          `${r[0].padEnd(w0)} ${r[1].padEnd(w1)} ${r[2].padStart(w2)} ${r[3].padEnd(w3)} ${r[4]}\n`,
        );
      }
    });
}
