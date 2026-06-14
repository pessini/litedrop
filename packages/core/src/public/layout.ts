// Minimal app-chrome wrapper for SSR public pages. Kept dependency-free. Inline
// styles only so it works under the strict CSP (no external stylesheets), and
// no JavaScript: the theme switcher is pure CSS (hidden radio inputs + sibling
// selectors), preserving the no-script guarantee of the app-origin pages.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Three reader themes. Each is a block of CSS custom properties on .ld-page;
// the checked radio (a sibling preceding .ld-page) selects which block wins.
// Light is the default (radio pre-checked), so browsers without sibling/var
// support still get a sane page.
const BASE_CSS = `
* { box-sizing: border-box; }
body { margin: 0; }
.ld-t { position: absolute; opacity: 0; pointer-events: none; }
.ld-page {
  color-scheme: light;
  --bg: #f6f7f9; --panel: #ffffff; --text: #1f2328; --muted: #848d97;
  --border: #e3e6ea; --rule: #eceef1; --link: #2563eb;
  --code-bg: #f5f7fa; --code-inline: #eef1f4;
  --hl-kw: #d73a49; --hl-str: #032f62; --hl-com: #6a737d; --hl-num: #005cc5; --hl-title: #6f42c1;
  min-height: 100dvh;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg); color: var(--text);
}
#ld-t-dark:checked ~ .ld-page {
  color-scheme: dark;
  --bg: #0f1216; --panel: #161b22; --text: #d9e0e8; --muted: #7d8590;
  --border: #2a313c; --rule: #262c36; --link: #6ea8fe;
  --code-bg: #10141a; --code-inline: #232a33;
  --hl-kw: #ff7b72; --hl-str: #a5d6ff; --hl-com: #8b949e; --hl-num: #79c0ff; --hl-title: #d2a8ff;
}
#ld-t-sepia:checked ~ .ld-page {
  color-scheme: light;
  --bg: #f3ead7; --panel: #faf4e5; --text: #413422; --muted: #95825f;
  --border: #e3d4b4; --rule: #ebdfc5; --link: #9a5b2d;
  --code-bg: #f0e6ce; --code-inline: #ebdfc5;
  --hl-kw: #a13b1e; --hl-str: #1d6b4e; --hl-com: #8b7a5a; --hl-num: #1d5d8c; --hl-title: #7a3fa0;
}
.ld-wrap { max-width: 820px; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
.ld-themebar { display: flex; justify-content: flex-end; gap: .25rem; margin-bottom: .75rem; }
.ld-themebar label {
  font-size: .75rem; color: var(--muted); border: 1px solid transparent;
  border-radius: 999px; padding: .2em .8em; cursor: pointer; user-select: none;
}
.ld-themebar label:hover { color: var(--text); }
#ld-t-light:checked ~ .ld-page label[for="ld-t-light"],
#ld-t-dark:checked ~ .ld-page label[for="ld-t-dark"],
#ld-t-sepia:checked ~ .ld-page label[for="ld-t-sepia"] {
  background: var(--panel); border-color: var(--border); color: var(--text);
}
#ld-t-light:focus-visible ~ .ld-page label[for="ld-t-light"],
#ld-t-dark:focus-visible ~ .ld-page label[for="ld-t-dark"],
#ld-t-sepia:focus-visible ~ .ld-page label[for="ld-t-sepia"] {
  outline: 2px solid var(--link); outline-offset: 2px;
}
.ld-content {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 2rem 2.25rem;
}
.ld-content > :first-child { margin-top: 0; }
.ld-content h1, .ld-content h2 { border-bottom: 1px solid var(--rule); padding-bottom: .3em; }
.ld-content a { color: var(--link); }
.ld-content blockquote {
  margin: 1em 0; padding: .1em 1em; color: var(--muted);
  border-left: 4px solid var(--border);
}
.ld-content hr { border: 0; border-top: 1px solid var(--rule); }
.ld-content pre { background: var(--code-bg); border: 1px solid var(--rule); padding: 1rem; border-radius: 8px; overflow: auto; }
.ld-content code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
.ld-content :not(pre) > code { background: var(--code-inline); padding: .15em .4em; border-radius: 4px; }
.ld-content table { border-collapse: collapse; width: 100%; }
.ld-content th, .ld-content td { border: 1px solid var(--border); padding: .4em .6em; }
.ld-content img { max-width: 100%; }
.ld-foot { margin-top: 1.5rem; font-size: .8rem; color: var(--muted); display: flex; gap: 1rem; justify-content: space-between; }
.ld-foot a { color: var(--muted); }
.ld-foot .ld-brand { font-weight: 600; text-decoration: none; }
.ld-foot .ld-brand:hover { text-decoration: underline; }
.ld-report { display: inline; margin: 0; }
.ld-report button { background: none; border: 0; padding: 0; font: inherit;
  color: var(--muted); text-decoration: underline; cursor: pointer; }
.hljs { display: block; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in { color: var(--hl-kw); }
.hljs-string, .hljs-attr { color: var(--hl-str); }
.hljs-comment { color: var(--hl-com); font-style: italic; }
.hljs-number, .hljs-literal { color: var(--hl-num); }
.hljs-title, .hljs-name { color: var(--hl-title); }
`;

export interface PageOptions {
  title: string;
  /** Already-sanitized/escaped HTML to place inside .ld-content. */
  bodyHtml: string;
  slug: string;
}

export function pageShell({ title, bodyHtml, slug }: PageOptions): string {
  // Reporting only makes sense on an actual share page. A one-click POST (a
  // button styled as a link), never a GET link — scanners and prefetchers
  // follow links, and a report must cost a deliberate click.
  const reportLink = slug
    ? `<form class="ld-report" method="post" action="/s/${encodeURIComponent(slug)}/report"><button type="submit">report abuse</button></form>`
    : `<a href="/acceptable-use">acceptable use</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · litedrop</title>
<style>${BASE_CSS}</style>
</head>
<body>
<input type="radio" name="ld-theme" id="ld-t-light" class="ld-t" checked aria-label="Light theme">
<input type="radio" name="ld-theme" id="ld-t-dark" class="ld-t" aria-label="Dark theme">
<input type="radio" name="ld-theme" id="ld-t-sepia" class="ld-t" aria-label="Sepia theme">
<div class="ld-page">
<div class="ld-wrap">
<nav class="ld-themebar" aria-label="Theme">
<label for="ld-t-light">Light</label>
<label for="ld-t-dark">Dark</label>
<label for="ld-t-sepia">Sepia</label>
</nav>
<article class="ld-content">${bodyHtml}</article>
<footer class="ld-foot">
<span>shared via <a class="ld-brand" href="/">litedrop</a> · <a href="/terms">terms</a></span>
${reportLink}
</footer>
</div>
</div>
</body>
</html>`;
}

export interface HtmlHostOptions {
  slug: string;
  filename: string;
  /** Content-origin iframe URL (carries the signed content token). */
  contentUrl: string;
}

// Host page for an HTML share. A provenance banner above a sandboxed,
// full-viewport iframe whose src is the ISOLATED content origin, and a slim
// provenance footer under it.
// `sandbox="allow-scripts"` lets agent HTML run its JS (charts, etc.) but
// withholds `allow-same-origin`, so the document keeps an OPAQUE origin — no
// access to the content origin's cookies/storage, and no app cookies exist
// there anyway. Forms, popups, and top-navigation stay blocked. Inline styles
// only (works under the host-page CSP).
export function htmlHostPage({
  slug,
  filename,
  contentUrl,
}: HtmlHostOptions): string {
  const enc = encodeURIComponent(slug);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(filename)} · litedrop</title>
<style>
html, body { height: 100%; }
body { margin: 0; display: flex; flex-direction: column;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.ld-hide { position: absolute; opacity: 0; pointer-events: none; }
.ld-bar { display: flex; gap: 1rem; justify-content: space-between; align-items: center;
  flex-wrap: wrap; padding: .6rem 1rem; background: #eff6ff; color: #1e40af;
  border-bottom: 1px solid #bfdbfe; }
.ld-bar a { color: #1e40af; }
.ld-bar form { display: inline; margin: 0; }
.ld-bar form button { background: none; border: 0; padding: 0; font: inherit;
  color: #1e40af; text-decoration: underline; cursor: pointer; }
.ld-bar label { cursor: pointer; padding: 0 .35em; border-radius: 4px; user-select: none; }
.ld-bar label:hover { background: #dbeafe; }
#ld-hide:checked ~ .ld-bar { display: none; }
#ld-hide:focus-visible ~ .ld-bar label { outline: 2px solid #1e40af; outline-offset: 2px; }
.ld-frame { flex: 1 1 auto; width: 100%; border: 0; }
.ld-mark { flex: none; text-align: center; padding: .3rem 1rem; font-size: .75rem;
  color: #6b7280; background: #fafafa; border-top: 1px solid #e5e7eb; }
.ld-mark a { color: inherit; font-weight: 600; text-decoration: none; }
.ld-mark a:hover { text-decoration: underline; }
</style>
</head>
<body>
<input type="checkbox" id="ld-hide" class="ld-hide" aria-label="Hide this notice">
<div class="ld-bar" role="note">
  <span>🔒 This page is displayed in an isolated, secure sandbox.</span>
  <span><form method="post" action="/s/${enc}/report"><button type="submit">report abuse</button></form> · <label for="ld-hide" title="Hide this notice">✕</label></span>
</div>
<iframe class="ld-frame" src="${escapeHtml(contentUrl)}" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Shared HTML preview (sandboxed)"></iframe>
<footer class="ld-mark">shared via <a href="/">litedrop</a></footer>
</body>
</html>`;
}

export { escapeHtml };
