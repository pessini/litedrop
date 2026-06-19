import assert from "node:assert/strict";
import { test } from "node:test";

process.env.APP_BASE_URL = "https://app.example.com";
process.env.PUBLIC_SHARE_BASE_URL = "https://share.example.com";
process.env.CONTENT_BASE_URL = "https://content.example.com";
process.env.UNLOCK_COOKIE_SECRET = "openapi-test-secret";

const { buildOpenApiDocument } = await import("../src/openapi.ts");

test("public share operations advertise the configured share origin", () => {
  const document = buildOpenApiDocument("https://app.example.com");

  assert.deepEqual(document.servers, [{ url: "https://app.example.com" }]);

  for (const [path, method] of [
    ["/{slug}", "get"],
    ["/{slug}/raw", "get"],
    ["/{slug}/unlock", "post"],
    ["/{slug}/report", "post"],
  ] as const) {
    const operation = document.paths[path][method] as {
      servers?: { url: string }[];
    };
    assert.deepEqual(
      operation.servers,
      [{ url: "https://share.example.com" }],
      `${method.toUpperCase()} ${path}`,
    );
  }
});
