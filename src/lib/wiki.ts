/**
 * Jira wiki markup <-> HTML glue for the rich (TipTap) description editor.
 *
 * - `renderedToEditorHtml` massages the HTML Jira Server renders for a
 *   description into something TipTap's schema can load faithfully.
 * - `htmlToWiki` converts HTML back to wiki markup. It understands both
 *   TipTap's output (`<strong>`, `<pre><code class="language-x">`,
 *   `<li><p>`, ...) and Jira's own rendering (code/preformatted panels,
 *   `image-wrap`, `user-hover` mentions, issue links, confluenceTable, ...).
 *
 * The conversion is intentionally lossy for constructs that have no editable
 * counterpart (colors, panel parameters, macros); callers detect that with
 * `roundTrips()` and warn before the user edits.
 */
import { prepareJiraHtml } from "./html";

const EMOTICONS: Record<string, string> = {
  smile: ":)",
  sad: ":(",
  tongue: ":P",
  biggrin: ":D",
  wink: ";)",
  thumbs_up: "(y)",
  thumbs_down: "(n)",
  information: "(i)",
  check: "(/)",
  error: "(x)",
  warning: "(!)",
  add: "(+)",
  forbidden: "(-)",
  help_16: "(?)",
  lightbulb_on: "(on)",
  lightbulb: "(off)",
  star_yellow: "(*)",
  star_red: "(*r)",
  star_green: "(*g)",
  star_blue: "(*b)",
  flag: "(flag)",
  flag_grey: "(flagoff)",
};

const INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BIG",
  "CITE",
  "CODE",
  "DEL",
  "DFN",
  "EM",
  "FONT",
  "I",
  "IMG",
  "INS",
  "KBD",
  "LABEL",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRIKE",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "TT",
  "U",
  "VAR",
  "WBR",
]);

interface Ctx {
  /** Characters marking the current list nesting, e.g. "*#" for an ol inside a ul. */
  listPrefix: string;
}

function isElement(n: Node): n is HTMLElement {
  return n.nodeType === Node.ELEMENT_NODE;
}

function isInline(n: Node): boolean {
  if (n.nodeType === Node.TEXT_NODE) return true;
  if (!isElement(n)) return false;
  if (n.tagName === "BR") return true;
  return INLINE_TAGS.has(n.tagName);
}

function attachmentName(url: string): string | null {
  const m = url.match(/\/secure\/(?:attachment|thumbnail)\/\d+\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isThumbnail(url: string): boolean {
  return /\/secure\/thumbnail\//.test(url);
}

function emoticonName(url: string): string | null {
  const m = url.match(/\/images\/icons\/emoticons\/([\w]+)\.(?:png|gif|svg)/);
  return m ? m[1] : null;
}

function origSrc(img: HTMLImageElement): string {
  return img.getAttribute("data-orig-src") ?? img.getAttribute("src") ?? "";
}

function userFromHref(href: string): string | null {
  const m = href.match(/ViewProfile\.jspa\?name=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function issueKeyFromHref(href: string): string | null {
  const m = href.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[?#]|$)/);
  return m ? m[1] : null;
}

/** `*text*`-style wrapping that keeps surrounding whitespace outside the markers. */
function wrap(text: string, marker: string): string {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m || !m[2]) return text;
  return `${m[1]}${marker}${m[2]}${marker}${m[3]}`;
}

/** Inline formatting a contenteditable may express as CSS instead of tags. */
function styleWrap(el: HTMLElement, inner: string): string {
  const st = el.style;
  if (!st) return inner;
  let out = inner;
  const fw = st.fontWeight;
  if (fw === "bold" || fw === "bolder" || (parseInt(fw, 10) || 0) >= 600) out = wrap(out, "*");
  if (st.fontStyle === "italic") out = wrap(out, "_");
  const td = st.textDecorationLine || st.textDecoration;
  if (td.includes("underline")) out = wrap(out, "+");
  if (td.includes("line-through")) out = wrap(out, "-");
  if (st.color && el.tagName !== "FONT") out = `{color:${st.color}}${out}{color}`;
  return out;
}

function inlineChildren(el: Node, ctx: Ctx): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) out += inline(child, ctx);
  return out;
}

function inline(node: Node, ctx: Ctx): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? "").replace(/\s+/g, " ");
  }
  if (!isElement(node)) return "";
  const el = node;
  const tag = el.tagName;
  const inner = () => inlineChildren(el, ctx).replace(/^ +| +$/g, (m) => m.slice(0, 1));

  switch (tag) {
    case "BR":
      return "\n";
    case "B":
    case "STRONG":
      return wrap(inner(), "*");
    case "I":
    case "EM":
      return wrap(inner(), "_");
    case "U":
    case "INS":
      return wrap(inner(), "+");
    case "DEL":
    case "S":
    case "STRIKE":
      return wrap(inner(), "-");
    case "SUP":
      return `^${inner()}^`;
    case "SUB":
      return `~${inner()}~`;
    case "CITE":
      return `??${inner()}??`;
    case "TT":
    case "CODE":
    case "KBD":
    case "SAMP":
    case "VAR":
      return `{{${el.textContent ?? ""}}}`;
    case "FONT": {
      const color = el.getAttribute("color");
      const t = inner();
      return color ? `{color:${color}}${t}{color}` : t;
    }
    case "IMG": {
      const img = el as HTMLImageElement;
      const src = origSrc(img);
      const emoticon = emoticonName(src);
      if (emoticon !== null || img.classList.contains("emoticon")) return EMOTICONS[emoticon ?? ""] ?? "";
      if (isThumbnail(src)) {
        // Jira thumbnails are `_thumb_<id>.png`; the attachment name lives in the alt text
        // and on the wrapping link to the full-size file.
        const parent = img.parentElement instanceof HTMLAnchorElement ? attachmentName(img.parentElement.getAttribute("href") ?? "") : null;
        const name = img.getAttribute("alt")?.trim() || parent || attachmentName(src);
        return name ? `!${name}|thumbnail!` : "";
      }
      const name = attachmentName(src);
      if (name) return `!${name}!`;
      return src ? `!${src}!` : "";
    }
    case "A": {
      const a = el as HTMLAnchorElement;
      const href = a.getAttribute("href") ?? "";
      const text = inner().trim();
      // Anchor without target (`<a name="...">` from headings).
      if (!href) return text;
      // Thumbnail wrapper: the image already carries the attachment name.
      const onlyImg = a.childElementCount === 1 && a.firstElementChild?.tagName === "IMG" && !(a.textContent ?? "").trim();
      if (onlyImg) return inlineChildren(a, ctx);
      const user = userFromHref(href) ?? (a.classList.contains("user-hover") ? a.getAttribute("rel") : null);
      if (user) return `[~${user}]`;
      const key = a.dataset.issueKey ?? issueKeyFromHref(href);
      if (key) return text.replace(/^-|-$/g, "") === key ? key : `[${text}|${key}]`;
      const target = a.dataset.href ?? href;
      if (!text || text === target) return `[${target}]`;
      return `[${text}|${target}]`;
    }
    case "SPAN": {
      if (el.classList.contains("code-quote") || el.classList.contains("code-keyword")) return el.textContent ?? "";
      return styleWrap(el, inlineChildren(el, ctx));
    }
    default:
      return styleWrap(el, inlineChildren(el, ctx));
  }
}

function paragraph(text: string): string[] {
  const t = text
    .split("\n")
    .map((l) => l.replace(/^ +| +$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  return t ? [t] : [];
}

function codeBlock(pre: HTMLElement, panel: HTMLElement | null): string {
  const text = (pre.textContent ?? "").replace(/^\n+|\n+$/g, "");
  if (panel?.classList.contains("preformatted") || pre.hasAttribute("data-noformat")) {
    return `{noformat}\n${text}\n{noformat}`;
  }
  const params: string[] = [];
  const classes = [...Array.from(pre.classList), ...Array.from(pre.querySelector("code")?.classList ?? [])];
  const lang = classes.find((c) => c.startsWith("code-"))?.slice(5) ?? classes.find((c) => c.startsWith("language-"))?.slice(9);
  if (lang && lang !== "java") params.push(lang);
  const title = panel?.querySelector(".codeHeader")?.textContent?.trim();
  if (title) params.push(`title=${title}`);
  const head = params.length ? `{code:${params.join("|")}}` : "{code}";
  return `${head}\n${text}\n{code}`;
}

function list(el: HTMLElement, ctx: Ctx): string[] {
  const bullet = el.tagName === "OL" ? "#" : el.getAttribute("type") === "square" ? "-" : "*";
  const prefix = ctx.listPrefix + bullet;
  const lines: string[] = [];
  for (const li of Array.from(el.children)) {
    if (li.tagName !== "LI") continue;
    let text = "";
    const nested: string[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (isElement(child) && (child.tagName === "UL" || child.tagName === "OL")) {
        nested.push(...list(child, { listPrefix: prefix }));
      } else if (isInline(child)) {
        text += inline(child, ctx);
      } else {
        text += " " + blocks(child, ctx).join(" ");
      }
    }
    text = text.replace(/\s*\n\s*/g, " ").trim();
    lines.push(`${prefix} ${text}`);
    lines.push(...nested);
  }
  return lines;
}

function table(tbl: HTMLElement, ctx: Ctx): string {
  const rows: string[] = [];
  for (const tr of Array.from(tbl.querySelectorAll("tr"))) {
    const cells = Array.from(tr.children).filter((c) => c.tagName === "TD" || c.tagName === "TH");
    if (!cells.length) continue;
    const header = cells.every((c) => c.tagName === "TH");
    const sep = header ? "||" : "|";
    const content = cells.map((c) => blocks(c, ctx).join(" ").replace(/\n/g, " ").trim() || " ");
    rows.push(sep + content.join(sep) + sep);
  }
  return rows.join("\n");
}

/** Render `parent`'s children as a list of wiki blocks (paragraphs, lists, macros...). */
function blocks(parent: Node, ctx: Ctx): string[] {
  const out: string[] = [];
  let buf = "";
  const flush = () => {
    out.push(...paragraph(buf));
    buf = "";
  };

  for (const node of Array.from(parent.childNodes)) {
    if (isInline(node)) {
      buf += inline(node, ctx);
      continue;
    }
    if (!isElement(node)) continue;
    flush();
    out.push(...block(node, ctx));
  }
  flush();
  return out;
}

function block(el: HTMLElement, ctx: Ctx): string[] {
  const tag = el.tagName;
  const cls = el.classList;
  switch (tag) {
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6": {
      const t = inlineChildren(el, ctx).replace(/\n/g, " ").trim();
      return t ? [`h${tag[1]}. ${t}`] : [];
    }
    case "P":
      return paragraph(inlineChildren(el, ctx));
    case "HR":
      return ["----"];
    case "UL":
    case "OL":
      return [list(el, ctx).join("\n")];
    case "PRE":
      return [codeBlock(el, null)];
    case "BLOCKQUOTE": {
      const inner = blocks(el, ctx);
      if (inner.length === 1 && !inner[0].includes("\n")) return [`bq. ${inner[0]}`];
      return [`{quote}\n${inner.join("\n\n")}\n{quote}`];
    }
    case "TABLE":
      return [table(el, ctx)];
    case "DIV":
    case "SECTION":
    case "ARTICLE": {
      if (cls.contains("code") || cls.contains("preformatted")) {
        const pre = el.querySelector("pre");
        return pre ? [codeBlock(pre, el)] : blocks(el, ctx);
      }
      if (cls.contains("panel")) {
        const header = el.querySelector(":scope > .panelHeader")?.textContent?.trim();
        const content = el.querySelector(":scope > .panelContent") ?? el;
        const inner = blocks(content, ctx).join("\n\n");
        return [`{panel${header ? `:title=${header}` : ""}}\n${inner}\n{panel}`];
      }
      if (cls.contains("table-wrap")) {
        const t = el.querySelector("table");
        return t ? [table(t, ctx)] : [];
      }
      return blocks(el, ctx);
    }
    default:
      return blocks(el, ctx);
  }
}

export function htmlToWiki(html: string): string {
  if (!html.trim()) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return blocks(doc.body, { listPrefix: "" }).join("\n\n").trim();
}

/** Normalise markup so semantically identical texts compare equal. */
export function normalizeWiki(markup: string): string {
  return markup
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, "").replace(/^(h[1-6]\.|bq\.|[*#-]+)\s+/, "$1 "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when `html` (the editor's document) converts back to the same markup. */
export function roundTrips(markup: string, html: string): boolean {
  return normalizeWiki(htmlToWiki(html)) === normalizeWiki(markup);
}

/**
 * Prepare Jira's rendered description HTML for loading into TipTap:
 * authenticated image URLs, absolute links, `<pre><code class="language-x">`
 * code blocks, and no decorative macro chrome (status lozenges, icons).
 */
export function renderedToEditorHtml(renderedHtml: string, baseUrl: string): string {
  const doc = new DOMParser().parseFromString(prepareJiraHtml(renderedHtml, baseUrl), "text/html");
  doc.querySelectorAll(".jira-issue-macro .aui-lozenge, .jira-issue-macro img.icon, a[name]:empty").forEach((n) => n.remove());
  doc.querySelectorAll<HTMLAnchorElement>("a[data-href]").forEach((a) => {
    a.setAttribute("href", a.dataset.href ?? "");
  });
  doc.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    const panel = pre.closest(".panel");
    const lang = Array.from(pre.classList)
      .find((c) => c.startsWith("code-"))
      ?.slice(5);
    const code = doc.createElement("code");
    code.textContent = pre.textContent ?? "";
    if (panel?.classList.contains("preformatted")) pre.setAttribute("data-noformat", "");
    else if (lang) code.className = `language-${lang}`;
    pre.replaceChildren(code);
    pre.removeAttribute("class");
    if (panel) panel.replaceWith(pre);
  });
  return doc.body.innerHTML;
}
