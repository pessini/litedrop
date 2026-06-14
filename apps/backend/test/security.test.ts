import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIpFromHeaders } from "../src/lib/request.ts";
import { userContentCsp } from "../src/middleware/csp.ts";
import {
  isContentOriginRequestHost,
  publicOriginConfigErrors,
} from "../src/public/tokens.ts";
import {
  rawUploadControls,
  readStreamUpToLimit,
} from "../src/shares/routes.ts";

test("content route host gate only accepts the configured content origin", () => {
  assert.equal(
    isContentOriginRequestHost(
      "app.example.com",
      undefined,
      "https://content.example.com",
    ),
    false,
  );
  assert.equal(
    isContentOriginRequestHost(
      "content.example.com",
      undefined,
      "https://content.example.com",
    ),
    true,
  );
  assert.equal(
    isContentOriginRequestHost(
      "internal:8080",
      "content.example.com",
      "https://content.example.com",
    ),
    false,
  );
});

test("production public-origin config requires content isolation and stable signing", () => {
  const errors = publicOriginConfigErrors({
    nodeEnv: "production",
    appBaseUrl: "https://app.example.com",
    contentBaseUrl: undefined,
    allowSameOriginContent: false,
    unlockSecretSource: "ephemeral",
  });
  assert.equal(errors.length, 2);
  assert.match(errors[0]!, /UNLOCK_COOKIE_SECRET or make DATA_DIR writable/);
  assert.match(errors[1]!, /CONTENT_BASE_URL is required in production/);

  assert.deepEqual(
    publicOriginConfigErrors({
      nodeEnv: "production",
      appBaseUrl: "https://app.example.com",
      contentBaseUrl: "https://app.example.com",
      allowSameOriginContent: false,
      unlockSecretSource: "env",
    }),
    ["CONTENT_BASE_URL must use a different origin from APP_BASE_URL"],
  );
});

test("single-user self-hosting can opt out of the content-origin requirement", () => {
  // A persisted first-boot secret counts as stable, and the explicit opt-out
  // clears the CONTENT_BASE_URL requirement — the zero-config container boots.
  assert.deepEqual(
    publicOriginConfigErrors({
      nodeEnv: "production",
      appBaseUrl: "https://drop.example.com",
      contentBaseUrl: undefined,
      allowSameOriginContent: true,
      unlockSecretSource: "persisted",
    }),
    [],
  );

  // The opt-out does NOT excuse a same-origin CONTENT_BASE_URL when one is set.
  assert.deepEqual(
    publicOriginConfigErrors({
      nodeEnv: "production",
      appBaseUrl: "https://drop.example.com",
      contentBaseUrl: "https://drop.example.com",
      allowSameOriginContent: true,
      unlockSecretSource: "persisted",
    }),
    ["CONTENT_BASE_URL must use a different origin from APP_BASE_URL"],
  );
});

test("user content CSP sandboxes direct navigations as well as iframes", () => {
  const policy = userContentCsp("https://app.example.com");

  assert.match(policy, /sandbox allow-scripts/);
  assert.doesNotMatch(policy, /allow-same-origin/);
});

test("raw upload passwords use a header instead of query strings", () => {
  assert.deepEqual(
    rawUploadControls({
      expiresQuery: "7d",
      passwordQuery: undefined,
      passwordHeader: "secret",
      maxViewsQuery: "3",
    }),
    { expires: "7d", password: "secret", max_views: "3" },
  );

  assert.throws(
    () =>
      rawUploadControls({
        expiresQuery: undefined,
        passwordQuery: "secret",
        passwordHeader: undefined,
        maxViewsQuery: undefined,
      }),
    /password must not be sent in the query string/,
  );
});

test("client IP ignores spoofable forwarding headers unless explicitly trusted", () => {
  const headers = {
    xForwardedFor: "198.51.100.10, 10.0.0.1",
    cfConnectingIp: "203.0.113.20",
    socketAddress: "192.0.2.30",
  };

  assert.equal(clientIpFromHeaders(headers, false), "192.0.2.30");
  assert.equal(clientIpFromHeaders(headers, true), "203.0.113.20");
  assert.equal(
    clientIpFromHeaders(
      { xForwardedFor: "198.51.100.10, 10.0.0.1", socketAddress: "192.0.2.30" },
      true,
    ),
    "198.51.100.10",
  );
});

test("upload body reader rejects streams that cross the configured cap", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.enqueue(new Uint8Array([4, 5, 6]));
      controller.close();
    },
  });

  await assert.rejects(
    () => readStreamUpToLimit(stream, 5),
    /file exceeds 5 byte limit/,
  );
});
