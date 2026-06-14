import assert from "node:assert/strict";
import { test } from "node:test";
import config from "../vite.config";

const proxy = config.server?.proxy ?? {};
const proxyKeys = Object.keys(proxy);

function proxyMatches(context: string, url: string): boolean {
  if (context.startsWith("^")) return new RegExp(context).test(url);
  return url.startsWith(context);
}

function matchedProxyKeys(url: string): string[] {
  return proxyKeys.filter((key) => proxyMatches(key, url));
}

test("dev proxy does not catch Vite source modules", () => {
  assert.deepEqual(matchedProxyKeys("/src/main.ts"), []);
});

test("dev proxy still catches public share and content routes", () => {
  assert.deepEqual(matchedProxyKeys("/s/example-slug"), ["^/s(?:/|$)"]);
  assert.deepEqual(matchedProxyKeys("/c/example-slug"), ["^/c(?:/|$)"]);
});
