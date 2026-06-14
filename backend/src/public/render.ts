import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

// Markdown → HTML for the APP origin. GFM-ish + syntax highlighting, then run
// through a sanitize-html allowlist. No raw HTML passthrough here; user HTML
// files are served via the isolated content origin.

const md: MarkdownIt = new MarkdownIt({
  html: false, // do not emit raw HTML embedded in the markdown source
  linkify: true,
  typographer: true,
  highlight(code, lang): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const { value } = hljs.highlight(code, { language: lang });
        return `<pre class="hljs"><code class="language-${lang}">${value}</code></pre>`;
      } catch {
        // fall through to escaped default
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

// Allowlist: markdown-it output + highlight.js span classes. No scripts, no
// styles, no event handlers; links forced to safe schemes and noopener.
const SANITIZE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "br",
    "pre",
    "code",
    "span",
    "em",
    "strong",
    "del",
    "ins",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    code: ["class"],
    span: ["class"],
    pre: ["class"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
};

export function renderMarkdown(source: string): string {
  return sanitizeHtml(md.render(source), SANITIZE_OPTS);
}
