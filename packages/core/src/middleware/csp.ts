// Content-Security-Policy builders for the public path.
//
// Three policies, strictest-first ("default-src 'none', then minimal
// allowances"):
//   - appPageCsp        app-origin SSR pages (markdown render, prompt, 404).
//   - htmlHostCsp       app-origin host page that frames user HTML.
//   - userContentCsp    the user HTML itself, served on the content origin.
//
// The two app-origin policies emit no `script-src` (under `default-src 'none'`),
// so JS never runs on pages we render. The content policy DOES allow scripts —
// agent HTML needs them — but only inside the opaque, app-cookie-free iframe
// sandbox, and with connect-src/form-action locked down (see userContentCsp).

function csp(directives: Record<string, string>): string {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

// The dashboard SPA (built dashboard/ bundle served by the backend in production).
// Unlike the SSR pages this one runs JS — but only our own same-origin bundle.
// 'unsafe-inline' styles cover Vue's dynamic style bindings; img https: covers
// OAuth avatar URLs (GitHub/Google CDNs); connect-src 'self' is the API.
export function spaCsp(): string {
  return csp({
    "default-src": "'none'",
    "script-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' https: data:",
    "font-src": "'self' data:",
    "connect-src": "'self'",
    "base-uri": "'none'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  });
}

// SSR pages we render ourselves: inline <style>, markdown images over https/
// data, no framing of or by anyone. form-action 'self' covers the unlock POST.
export function appPageCsp(): string {
  return csp({
    "default-src": "'none'",
    "img-src": "https: data:",
    "style-src": "'unsafe-inline'",
    "font-src": "https: data:",
    "base-uri": "'none'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  });
}

// Host page for an HTML share: like appPageCsp, but may frame the content
// origin (and only the content origin) for the sandboxed iframe.
export function htmlHostCsp(contentOrigin: string): string {
  return csp({
    "default-src": "'none'",
    "img-src": "https: data:",
    "style-src": "'unsafe-inline'",
    "frame-src": contentOrigin,
    "base-uri": "'none'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  });
}

// The raw user HTML on the content origin. Tuned for real agent-generated
// reports, which are self-contained HTML that still pull libraries from a CDN
// (Chart.js, Tailwind, mermaid, Google Fonts) — so inline AND https scripts/
// styles/fonts/images/media are allowed and JS runs (in the opaque, app-cookie-
// free sandbox). The containment that remains:
//   - connect-src 'none' — no fetch/XHR/WebSocket: blocks runtime data
//     exfiltration and using the viewer as a request proxy. (Report data is
//     inlined, so this costs almost no fidelity.)
//   - form-action 'none' — no form posts: blocks credential-phishing forms.
//   - frame-ancestors <app origin> — embeddable only by our host page.
//   - 'unsafe-eval' is allowed because Tailwind's Play CDN and some chart libs
//     compile via new Function/eval; with connect-src 'none' + opaque origin it
//     adds no exfiltration path. (Drop it to tighten at some fidelity cost.)
// `frameAncestors` is a CSP source list naming who may frame this content
// (core: the app origin).
export function userContentCsp(frameAncestors: string): string {
  return csp({
    "default-src": "'none'",
    "script-src": "'unsafe-inline' 'unsafe-eval' https:",
    "style-src": "'unsafe-inline' https:",
    "img-src": "data: https:",
    "font-src": "data: https:",
    "media-src": "data: https:",
    "connect-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
    "frame-ancestors": frameAncestors,
    sandbox: "allow-scripts",
  });
}
