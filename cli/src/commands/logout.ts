import type { Command } from "commander";
import { loadFileConfig, saveFileConfig } from "../config.ts";

// `logout` forgets the stored API key (leaves base_url intact).
export function registerLogout(program: Command): void {
  program
    .command("logout")
    .description("Forget the stored API key.")
    .action(() => {
      const fc = loadFileConfig();
      const hadKey = fc.api_key !== undefined;
      delete fc.api_key;
      saveFileConfig(fc);
      process.stderr.write(`${hadKey ? "logged out" : "no stored key"}\n`);
    });
}
