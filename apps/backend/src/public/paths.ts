const SHARE_SLUG_PATTERN = "[A-Za-z0-9_-]{12}";

export function sharePath(slug: string, suffix = ""): string {
  return `/${encodeURIComponent(slug)}${suffix}`;
}

export function shareRoute(suffix = ""): string {
  return `/:slug{${SHARE_SLUG_PATTERN}}${suffix}`;
}

export function legacyShareRoute(suffix = ""): string {
  return `/s/:slug{${SHARE_SLUG_PATTERN}}${suffix}`;
}

export function shareRawPath(slug: string): string {
  return sharePath(slug, "/raw");
}

export function shareUnlockPath(slug: string): string {
  return sharePath(slug, "/unlock");
}

export function shareReportPath(slug: string): string {
  return sharePath(slug, "/report");
}
