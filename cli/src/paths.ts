import { homedir } from "node:os";
import { join } from "node:path";

// Resolve the per-user config directory so the credential file lands where
// each OS expects:
//   macOS   → ~/Library/Application Support
//   Windows → %APPDATA%
//   else    → $XDG_CONFIG_HOME or ~/.config
export function configDir(): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData && appData.length > 0) return appData;
    return join(homedir(), "AppData", "Roaming");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return xdg;
  return join(homedir(), ".config");
}

export function configPath(): string {
  return join(configDir(), "litedrop", "config.json");
}
