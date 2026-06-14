import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// End-to-end tests: spawn the real CLI (native type stripping, no build
// needed) against an in-process mock of the litedrop backend, and assert the
// process-level contract — stdout content, stderr, and exit codes — that
// agents depend on.

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const GOOD_KEY = "ld_live_test_key";

interface MockShare {
  id: string;
  slug: string;
  url: string;
  raw_url: string;
  filename: string;
  kind: string;
  size_bytes: number;
  view_count: number;
  expires_at: string | null;
  max_views: number | null;
  has_password: boolean;
  status: string;
  created_at: string;
}

let server: Server;
let baseUrl = "";
let tmpHome = "";
const shares: MockShare[] = [];
let counter = 0;

function authed(auth: string | undefined): boolean {
  return auth === `Bearer ${GOOD_KEY}`;
}

before(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "litedrop-cli-test-"));
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    // Drain the request body (and measure it) so the socket never hangs.
    let size = 0;
    for await (const chunk of req) size += (chunk as Buffer).byteLength;

    if (!authed(req.headers.authorization)) {
      json(401, { error: "invalid api key" });
      return;
    }

    if (url.pathname === "/api/me") {
      json(200, {
        id: "u1",
        email: "agent@example.com",
        name: "Agent Smith",
        avatar_url: null,
        tier: "free",
        is_admin: false,
      });
      return;
    }

    if (url.pathname === "/api/shares" && req.method === "POST") {
      const name = url.searchParams.get("name");
      if (!name) {
        json(400, { error: "missing 'name' query parameter for raw upload" });
        return;
      }
      counter += 1;
      const slug = `slug${counter}`;
      const maxViews = url.searchParams.get("max_views");
      const share: MockShare = {
        id: `00000000-0000-0000-0000-${String(counter).padStart(12, "0")}`,
        slug,
        url: `${baseUrl}/s/${slug}`,
        raw_url: `${baseUrl}/s/${slug}/raw`,
        filename: name,
        kind: "markdown",
        size_bytes: size,
        view_count: 0,
        expires_at: null,
        max_views: maxViews !== null ? Number(maxViews) : null,
        has_password: req.headers["x-litedrop-share-password"] !== undefined,
        status: "active",
        created_at: new Date().toISOString(),
      };
      shares.unshift(share);
      json(201, share);
      return;
    }

    if (url.pathname === "/api/shares" && req.method === "GET") {
      json(200, { shares });
      return;
    }

    const delMatch = url.pathname.match(/^\/api\/shares\/([^/]+)$/);
    if (delMatch && req.method === "DELETE") {
      const id = delMatch[1];
      const idx = shares.findIndex((s) => s.id === id);
      if (idx === -1) {
        json(404, { error: "not found" });
        return;
      }
      const [removed] = shares.splice(idx, 1);
      json(200, { id: removed!.id, status: "revoked" });
      return;
    }

    json(404, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string")
    throw new Error("no server port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(tmpHome, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  opts: {
    apiKey?: string;
    stdin?: string;
    extraEnv?: Record<string, string>;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [MAIN, ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: tmpHome,
          XDG_CONFIG_HOME: tmpHome,
          LITEDROP_API_URL: baseUrl,
          LITEDROP_API_KEY: opts.apiKey ?? GOOD_KEY,
          ...opts.extraEnv,
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
    else child.stdin?.end();
  });
}

test("login with a rejected key fails (exit 3) and persists nothing", async () => {
  const { code } = await runCli(["login", "--key", "bogus"]);
  assert.equal(code, 3);
});

test("login validates against LITEDROP_API_URL and persists; logout forgets", async () => {
  // The env URL points at the mock server; login must use it, not the default.
  const login = await runCli(["login", "--key", GOOD_KEY]);
  assert.equal(login.code, 0);
  assert.match(login.stderr, /Logged in/);

  const cfgPath = join(tmpHome, "litedrop", "config.json");
  const saved = JSON.parse(readFileSync(cfgPath, "utf8")) as {
    api_key?: string;
  };
  assert.equal(saved.api_key, GOOD_KEY);

  const logout = await runCli(["logout"]);
  assert.equal(logout.code, 0);
  assert.match(logout.stderr, /logged out/);
  const after = JSON.parse(readFileSync(cfgPath, "utf8")) as {
    api_key?: string;
  };
  assert.equal(after.api_key, undefined);
});

test("a plain-http non-loopback base URL triggers a warning", async () => {
  const { code, stderr } = await runCli(["ls"], {
    extraEnv: { LITEDROP_API_URL: "http://litedrop.invalid" },
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /plain http/);
});

test("push writes only the share URL to stdout", async () => {
  const file = join(tmpHome, "note.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "# hi\n"));

  const { code, stdout, stderr } = await runCli(["push", file]);

  assert.equal(code, 0);
  assert.match(stdout, /^http:\/\/127\.0\.0\.1:\d+\/s\/slug\d+\n$/);
  assert.equal(stderr, "");
});

test("push --json writes the full share object", async () => {
  const file = join(tmpHome, "note2.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "body"));

  const { code, stdout } = await runCli(["push", file, "--json"]);

  assert.equal(code, 0);
  const share = JSON.parse(stdout) as MockShare;
  assert.equal(share.filename, "note2.md");
  assert.equal(share.status, "active");
});

test("push from stdin requires --name (usage error, exit 2)", async () => {
  const { code, stderr } = await runCli(["push", "-"], { stdin: "from stdin" });
  assert.equal(code, 2);
  assert.match(stderr, /--name is required when reading from stdin/);
});

test("push from stdin with --name uploads", async () => {
  const { code, stdout } = await runCli(["push", "-", "--name", "piped.md"], {
    stdin: "# piped\n",
  });
  assert.equal(code, 0);
  assert.match(stdout, /\/s\/slug\d+\n$/);
});

test("push rejects zero max views before upload", async () => {
  const file = join(tmpHome, "zero.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));

  const before = shares.length;
  const { code, stderr } = await runCli(["push", file, "--max-views", "0"]);

  assert.equal(code, 2);
  assert.match(stderr, /expected a positive integer/);
  assert.equal(shares.length, before);
});

test("push rejects non-decimal max views (hex/exponent forms)", async () => {
  const file = join(tmpHome, "hex.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));

  const { code, stderr } = await runCli(["push", file, "--max-views", "1e2"]);
  assert.equal(code, 2);
  assert.match(stderr, /expected a positive integer/);
});

test("push rejects a malformed --expires before upload", async () => {
  const file = join(tmpHome, "exp.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));

  const before = shares.length;
  const { code, stderr } = await runCli(["push", file, "--expires", "soon"]);
  assert.equal(code, 2);
  assert.match(stderr, /invalid value 'soon' for --expires/);
  assert.equal(shares.length, before);
});

test("a rejected key is an auth error (exit 3)", async () => {
  const file = join(tmpHome, "note3.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));

  const { code, stderr } = await runCli(["push", file], { apiKey: "bogus" });
  assert.equal(code, 3);
  assert.match(stderr, /^error: /);
});

test("a missing key is an auth error before any request (exit 3)", async () => {
  const file = join(tmpHome, "note4.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));

  const { code, stderr } = await runCli(["push", file], {
    extraEnv: { LITEDROP_API_KEY: "" },
  });
  assert.equal(code, 3);
  assert.match(stderr, /no API key/);
});

test("ls --json emits a JSON array; the table emits a header", async () => {
  await runCli(["push", join(tmpHome, "note.md")]); // ensure at least one share

  const asJson = await runCli(["ls", "--json"]);
  assert.equal(asJson.code, 0);
  assert.ok(Array.isArray(JSON.parse(asJson.stdout)));

  const asTable = await runCli(["ls"]);
  assert.equal(asTable.code, 0);
  assert.match(asTable.stdout, /SLUG\s+STATUS\s+VIEWS\s+EXPIRES\s+NAME/);
});

test("ls strips control characters from server-supplied fields", async () => {
  const file = join(tmpHome, "evil.md");
  await import("node:fs/promises").then((fs) => fs.writeFile(file, "x"));
  await runCli(["push", file, "--name", "\x1b[2Jevil.md"]);

  const { code, stdout } = await runCli(["ls"]);
  assert.equal(code, 0);
  assert.ok(!stdout.includes("\x1b"), "escape byte leaked into the table");
  assert.match(stdout, /\[2Jevil\.md/);
});

test("open resolves a slug to its URL on stdout", async () => {
  const pushed = await runCli(["push", join(tmpHome, "note.md"), "--json"]);
  const share = JSON.parse(pushed.stdout) as MockShare;

  const { code, stdout, stderr } = await runCli(["open", share.slug]);
  assert.equal(code, 0);
  assert.equal(stdout, `${share.url}\n`);
  assert.equal(stderr, "");
});

test("revoke by id deletes directly, without resolving via the list", async () => {
  const pushed = await runCli(["push", join(tmpHome, "note.md"), "--json"]);
  const share = JSON.parse(pushed.stdout) as MockShare;

  const { code, stderr } = await runCli(["revoke", share.id]);
  assert.equal(code, 0);
  assert.match(stderr, new RegExp(`revoked ${share.id}`));
});

test("revoke by an unknown id is a not-found error (exit 4)", async () => {
  const { code, stderr } = await runCli([
    "revoke",
    "00000000-0000-0000-0000-0000000000aa",
  ]);
  assert.equal(code, 4);
  assert.match(stderr, /no share matching/);
});

test("revoke deletes by slug and confirms on stderr", async () => {
  const pushed = await runCli(["push", join(tmpHome, "note.md"), "--json"]);
  const share = JSON.parse(pushed.stdout) as MockShare;

  const { code, stdout, stderr } = await runCli(["revoke", share.slug]);
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.match(
    stderr,
    new RegExp(`revoked ${share.slug} \\(${share.filename}\\)`),
  );
});
