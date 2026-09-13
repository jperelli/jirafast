import { convertFileSrc } from "@tauri-apps/api/core";

let assetBase: string | null = null;

/** `jira-asset://localhost/` on Linux/macOS, `http://jira-asset.localhost/` on Windows. */
function getAssetBase(): string {
  if (assetBase === null) {
    try {
      assetBase = convertFileSrc("", "jira-asset");
    } catch {
      // Not running inside Tauri (plain browser dev) — leave URLs untouched.
      assetBase = "";
    }
  }
  return assetBase;
}

function originOf(baseUrl: string): { origin: string; path: string } {
  try {
    const u = new URL(baseUrl);
    return { origin: u.origin, path: u.pathname.replace(/\/$/, "") };
  } catch {
    return { origin: "", path: "" };
  }
}

/**
 * Turn a URL found in Jira's rendered HTML into one the webview can load
 * through the authenticated `jira-asset` protocol. Returns `null` for URLs
 * that are not on the Jira host (left untouched).
 */
export function toAssetUrl(src: string, baseUrl: string): string | null {
  const base = getAssetBase();
  if (!base || !src || src.startsWith("data:") || src.startsWith("blob:")) return null;
  const { origin, path } = originOf(baseUrl);
  if (src.startsWith("//")) src = (origin.startsWith("https") ? "https:" : "http:") + src;
  if (/^https?:\/\//i.test(src)) {
    if (!origin || !src.startsWith(origin + "/")) return null;
    return base + src.slice(origin.length + 1);
  }
  if (src.startsWith("/")) return base + src.slice(1);
  // Relative to the Jira context path.
  return base + `${path}/${src}`.replace(/^\/+/, "");
}

/** Absolute browser URL for a Jira path or URL (used for "open in browser"). */
export function toJiraUrl(href: string, baseUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  const { origin, path } = originOf(baseUrl);
  if (href.startsWith("/")) return origin + href;
  return `${origin}${path}/${href}`;
}

const ISSUE_KEY_RE = /\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:[?#]|$)/;

/** If `href` points at an issue page on this Jira, return its key. */
export function issueKeyFromHref(href: string, baseUrl: string): string | null {
  const { origin } = originOf(baseUrl);
  if (/^https?:\/\//i.test(href) && origin && !href.startsWith(origin + "/")) return null;
  const m = href.match(ISSUE_KEY_RE);
  return m ? m[1] : null;
}

/**
 * Post-process server-rendered HTML (description, comments) so it displays
 * correctly inside the app: authenticated images, no scripts, safe links.
 */
export function prepareJiraHtml(html: string | null | undefined, baseUrl: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed").forEach((n) => n.remove());
  doc.querySelectorAll<HTMLElement>("[onclick],[onload],[onerror],[onmouseover]").forEach((n) => {
    for (const attr of Array.from(n.attributes)) {
      if (attr.name.startsWith("on")) n.removeAttribute(attr.name);
    }
  });
  doc.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    const rewritten = toAssetUrl(src, baseUrl);
    if (rewritten) {
      img.setAttribute("data-orig-src", src);
      img.setAttribute("src", rewritten);
    }
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    // Thumbnails of attachments link to the full-size file.
    const parentLink = img.closest("a");
    if (parentLink) {
      parentLink.setAttribute("data-attachment", parentLink.getAttribute("href") ?? "");
    }
  });
  doc.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const key = issueKeyFromHref(href, baseUrl);
    if (key) a.setAttribute("data-issue-key", key);
    a.setAttribute("data-href", toJiraUrl(href, baseUrl));
  });
  return doc.body.innerHTML;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
