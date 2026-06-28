import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  loadFileConfig,
  requireKey,
  resolveConfig,
  saveFileConfig,
} from "../src/config.ts";
import { CliError } from "../src/errors.ts";
import { configPath } from "../src/paths.ts";

// Redirect the config directory to a throwaway home so nothing touches the real
// ~/.config, and snapshot the env we mutate.
let home = "";
const ENV_KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "LITEDROP_API_KEY",
  "LITEDROP_API_URL",
] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), "litedrop-cfg-"));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = home;
  delete process.env.LITEDROP_API_KEY;
  delete process.env.LITEDROP_API_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

test("save/load round-trips the file config", () => {
  saveFileConfig({ api_key: "ld_live_abc", base_url: "http://example.test" });
  assert.ok(
    configPath().startsWith(home),
    "config path is redirected into the temp home",
  );
  assert.deepEqual(loadFileConfig(), {
    api_key: "ld_live_abc",
    base_url: "http://example.test",
  });
});

test("the credential file is written owner-only (0600)", {
  skip: process.platform === "win32",
}, () => {
  saveFileConfig({ api_key: "secret" });
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
});

test("the config directory is created owner-only (0700)", {
  skip: process.platform === "win32",
}, () => {
  saveFileConfig({ api_key: "secret" });
  assert.equal(statSync(dirname(configPath())).mode & 0o777, 0o700);
});

test("a pre-existing world-readable config is replaced with a 0600 one", {
  skip: process.platform === "win32",
}, () => {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), "{}\n", { mode: 0o644 });

  saveFileConfig({ api_key: "secret" });
  assert.equal(statSync(configPath()).mode & 0o777, 0o600);
});

test("a missing config file loads as empty, not an error", () => {
  assert.deepEqual(loadFileConfig(), {});
});

test("env overrides the file, and a trailing slash is trimmed", () => {
  saveFileConfig({ api_key: "from_file", base_url: "http://file.test" });
  process.env.LITEDROP_API_KEY = "from_env";
  process.env.LITEDROP_API_URL = "http://env.test/";

  const cfg = resolveConfig();
  assert.equal(cfg.apiKey, "from_env");
  assert.equal(cfg.baseUrl, "http://env.test");
});

test("the file is used when env is unset; default base applies with no config", () => {
  saveFileConfig({ api_key: "from_file" });
  const cfg = resolveConfig();
  assert.equal(cfg.apiKey, "from_file");
  assert.equal(cfg.baseUrl, "https://app.litedrop.dev");
});

test("requireKey throws an auth-coded CliError when no key resolves", () => {
  const cfg = resolveConfig();
  assert.throws(
    () => requireKey(cfg),
    (err: unknown) =>
      err instanceof CliError && err.kind === "auth" && err.exitCode === 3,
  );
});

test("an empty env key is treated as absent (falls back to file)", () => {
  saveFileConfig({ api_key: "from_file" });
  process.env.LITEDROP_API_KEY = "";
  assert.equal(resolveConfig().apiKey, "from_file");
});
