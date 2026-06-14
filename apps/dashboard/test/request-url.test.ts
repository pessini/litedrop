import assert from "node:assert/strict";
import { test } from "node:test";
import { requestUrlForFetch } from "../src/api/request-url";

test("requestUrlForFetch keeps same-origin requests relative", () => {
  assert.equal(
    requestUrlForFetch("", "/api/me", "https://app.example.com"),
    "/api/me",
  );
});

test("requestUrlForFetch preserves absolute off-origin API bases", () => {
  assert.equal(
    requestUrlForFetch(
      "https://api.example.com",
      "/api/me",
      "https://app.example.com",
    ),
    "https://api.example.com/api/me",
  );
});
