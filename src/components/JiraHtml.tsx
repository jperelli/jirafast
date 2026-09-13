import { useMemo, useRef, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { app, useBaseUrl, type LightboxItem } from "../lib/store";
import { prepareJiraHtml, toAssetUrl, toJiraUrl } from "../lib/html";

interface Props {
  html: string | null | undefined;
  className?: string;
}

/** Images worth opening fullscreen: not emoticons, not issue-type icons of issue macros. */
export function lightboxImages(root: HTMLElement, baseUrl: string): { items: LightboxItem[]; nodes: HTMLImageElement[] } {
  const nodes = Array.from(root.querySelectorAll<HTMLImageElement>("img:not(.emoticon)")).filter(
    (img) => !img.closest(".jira-issue-macro-key"),
  );
  const items = nodes.map((img) => {
    const link = img.closest("a");
    const full = link?.dataset.attachment || link?.getAttribute("href") || "";
    const orig = img.dataset.origSrc ?? img.getAttribute("src") ?? "";
    const fullSrc = full ? (toAssetUrl(full, baseUrl) ?? full) : img.src;
    const title =
      img.getAttribute("alt") || link?.getAttribute("title") || decodeURIComponent((full || orig).split("/").pop() ?? "image");
    return { src: fullSrc, title, href: toJiraUrl(full || orig, baseUrl) };
  });
  return { items, nodes };
}

/** Renders Jira's server-side HTML (descriptions, comments) with app-native link and image handling. */
export default function JiraHtml({ html, className = "" }: Props) {
  const baseUrl = useBaseUrl();
  const root = useRef<HTMLDivElement>(null);
  const prepared = useMemo(() => prepareJiraHtml(html, baseUrl), [html, baseUrl]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    const img = target.closest("img");
    if (img && root.current && !img.classList.contains("emoticon") && !img.closest(".jira-issue-macro-key")) {
      e.preventDefault();
      const { items, nodes } = lightboxImages(root.current, baseUrl);
      const idx = nodes.indexOf(img as HTMLImageElement);
      if (idx >= 0) {
        app.openLightbox(items, idx);
        return;
      }
    }
    const a = target.closest("a");
    if (!a) return;
    e.preventDefault();
    const key = a.dataset.issueKey;
    if (key && !e.ctrlKey && !e.metaKey) {
      void app.openIssue(key);
      return;
    }
    const href = a.dataset.href ?? a.getAttribute("href");
    if (href && href !== "#") void openUrl(href).catch((err) => app.notify(String(err), "error"));
  }

  return <div ref={root} className={`jira-html ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: prepared }} />;
}
