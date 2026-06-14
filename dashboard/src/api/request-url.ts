export type RequestQuery = Record<string, string | number | undefined>;

export function requestUrlForFetch(
  apiBase: string,
  path: string,
  currentOrigin: string,
  query: RequestQuery = {},
): string {
  const normalizedBase = apiBase.replace(/\/$/, "");
  const url = new URL(`${normalizedBase}${path}`, currentOrigin);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  if (url.origin === currentOrigin) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}
