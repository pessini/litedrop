// Display formatters shared across views.

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Human "expires" label: never / a past instant / a future instant. */
export function formatExpiry(iso: string | null): string {
  if (!iso) return "never expires";
  const when = new Date(iso).getTime();
  if (when <= Date.now()) return "expired";
  return `expires ${formatDate(iso)}`;
}

export function formatViews(count: number, max: number | null): string {
  return max === null ? `${count} views` : `${count} / ${max} views`;
}
