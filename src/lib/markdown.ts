/**
 * Markdown <-> Jira wiki markup.
 *
 * Both directions go through HTML so the existing converters do the heavy
 * lifting: Markdown -> HTML (marked) -> wiki (`htmlToWiki`), and Jira's
 * rendered HTML -> Markdown (turndown + GFM tables/strikethrough).
 */
import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import { htmlToWiki } from "./wiki";
import { toJiraUrl } from "./html";

marked.use({ gfm: true, breaks: false, async: false });

/** Markdown text -> HTML usable by TipTap and `htmlToWiki`. */
export function markdownToHtml(md: string): string {
  const html = marked.parse(md.replace(/\r\n/g, "\n"));
  return typeof html === "string" ? html : "";
}

export function markdownToWiki(md: string): string {
  return htmlToWiki(markdownToHtml(md));
}

/** Loose check so "Paste from Markdown" can warn when the clipboard is plain prose. */
export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\|)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|!\[[^\]]*\]\(/.test(text);
}

let turndown: TurndownService | null = null;

function td(): TurndownService {
  if (turndown) return turndown;
  const t = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**",
    hr: "---",
  });
  t.use(gfm);
  // Jira renders {{monospace}} as <tt>.
  t.addRule("monospace", {
    filter: (node) => node.nodeName === "TT",
    replacement: (content) => (content.trim() ? `\`${content}\`` : ""),
  });
  t.addRule("underline", {
    filter: ["u", "ins"],
    replacement: (content) => content,
  });
  t.addRule("mention", {
    filter: (node) => node.nodeName === "A" && node.classList.contains("user-hover"),
    replacement: (content) => `@${content.replace(/^@/, "")}`,
  });
  t.addRule("lineBreak", {
    filter: "br",
    replacement: () => "  \n",
  });
  turndown = t;
  return t;
}

/**
 * Jira's rendered HTML (description, comment) -> GitHub-flavoured Markdown.
 * URLs are made absolute against `baseUrl` so the result works outside the app.
 */
export function renderedHtmlToMarkdown(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, .jira-issue-macro .aui-lozenge, a[name]:empty").forEach((n) => n.remove());
  doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("data-orig-src") ?? img.getAttribute("src") ?? "";
    if (/\/images\/icons\/emoticons\//.test(src)) {
      img.replaceWith(doc.createTextNode(img.getAttribute("alt") ?? ""));
      return;
    }
    img.setAttribute("src", toJiraUrl(src, baseUrl));
  });
  doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.setAttribute("href", toJiraUrl(a.getAttribute("data-href") ?? a.getAttribute("href") ?? "", baseUrl));
  });
  // Jira code / noformat panels -> <pre><code class="language-x"> so the
  // fenced-code rule picks up the language.
  doc.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    const panel = pre.closest(".panel");
    const lang = Array.from(pre.classList)
      .find((c) => c.startsWith("code-"))
      ?.slice(5);
    const code = doc.createElement("code");
    code.textContent = pre.textContent ?? "";
    if (lang && lang !== "java" && !panel?.classList.contains("preformatted")) code.className = `language-${lang}`;
    pre.replaceChildren(code);
    if (panel) panel.replaceWith(pre);
  });
  doc.querySelectorAll<HTMLElement>(".panel").forEach((panel) => {
    const header = panel.querySelector(":scope > .panelHeader");
    const content = panel.querySelector(":scope > .panelContent") ?? panel;
    const quote = doc.createElement("blockquote");
    if (header) {
      const p = doc.createElement("p");
      const b = doc.createElement("strong");
      b.textContent = header.textContent?.trim() ?? "";
      p.append(b);
      quote.append(p);
    }
    quote.append(...Array.from(content.childNodes));
    panel.replaceWith(quote);
  });
  return td()
    .turndown(doc.body.innerHTML)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Rendered HTML -> clean, self-contained HTML for the system clipboard
 * (absolute URLs, no app-specific attributes or authenticated asset URLs).
 */
export function renderedHtmlForClipboard(html: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((n) => n.remove());
  doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("data-orig-src") ?? img.getAttribute("src") ?? "";
    img.setAttribute("src", toJiraUrl(src, baseUrl));
    img.removeAttribute("data-orig-src");
    img.removeAttribute("loading");
    img.removeAttribute("decoding");
  });
  doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.setAttribute("href", toJiraUrl(a.getAttribute("data-href") ?? a.getAttribute("href") ?? "", baseUrl));
    a.removeAttribute("data-href");
    a.removeAttribute("data-issue-key");
    a.removeAttribute("data-attachment");
  });
  return doc.body.innerHTML;
}
