import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { env } from "../env.ts";

// Small request-scoped helpers.

export interface ClientIpHeaders {
  xForwardedFor?: string;
  cfConnectingIp?: string;
  socketAddress?: string;
}

export function clientIpFromHeaders(
  headers: ClientIpHeaders,
  trustProxyHeaders: boolean,
): string {
  if (trustProxyHeaders) {
    const cf = headers.cfConnectingIp?.trim();
    if (cf) return cf;

    const firstForwarded = headers.xForwardedFor?.split(",")[0]?.trim();
    if (firstForwarded) return firstForwarded;
  }

  return headers.socketAddress ?? "unknown";
}

// Best-effort client IP for rate limiting. Proxy headers are accepted only when
// the deployment explicitly enables them; direct clients can spoof
// X-Forwarded-For / CF-Connecting-IP.
export function clientIp(c: Context): string {
  let socketAddress: string | undefined;
  try {
    socketAddress = getConnInfo(c).remote.address;
  } catch {
    socketAddress = undefined;
  }

  return clientIpFromHeaders(
    {
      xForwardedFor: c.req.header("x-forwarded-for"),
      cfConnectingIp: c.req.header("cf-connecting-ip"),
      socketAddress,
    },
    env.TRUST_PROXY_HEADERS,
  );
}
