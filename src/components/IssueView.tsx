import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { app, useApp, useAppShallow, useBaseUrl } from "../lib/store";
import { api, errorMessage } from "../lib/api";
import { absoluteTime, formatBytes, relativeTime } from "../lib/format";
import { toAssetUrl, toJiraUrl } from "../lib/html";
import { renderedHtmlForClipboard, renderedHtmlToMarkdown } from "../lib/markdown";
import { writeClipboardHtml, writeClipboardText } from "../lib/clipboard";
import type { Attachment, Comment, LinkedIssue, Transition } from "../lib/types";
import Avatar from "./Avatar";
import JiraHtml from "./JiraHtml";
import CommentBox from "./CommentBox";
import css from "./IssueView.module.css";

function escapePlain(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return `<p>${d.innerHTML.replace(/\n/g, "<br>")}</p>`;
}

function isImage(a: Attachment): boolean {
  return a.mimeType.startsWith("image/");
}

export default function IssueView() {
  const baseUrl = useBaseUrl();
  const issue = useApp((s) => s.issue);
  const me = useApp((s) => s.me);
  const { selectedKey, issueLoading, issueFromCache, issueError, focus, historyLength, onBoard } = useAppShallow((s) => ({
    selectedKey: s.selectedKey,
    issueLoading: s.issueLoading,
    issueFromCache: s.issueFromCache,
    issueError: s.issueError,
    focus: s.focus,
    historyLength: s.history.length,
    onBoard: s.view === "board",
  }));
  const f = issue?.fields;
  const rendered = issue?.renderedFields;

  const [newestFirst, setNewestFirst] = useState(false);
  const [copying, setCopying] = useState<"html" | "wiki" | "md" | null>(null);

  async function copyDescription(kind: "html" | "wiki" | "md") {
    if (!f || copying) return;
    setCopying(kind);
    try {
      const wiki = f.description ?? "";
      const html = rendered?.description ?? escapePlain(wiki);
      if (kind === "wiki") {
        await writeClipboardText(wiki);
        app.notify("Copied as Jira markup");
      } else if (kind === "md") {
        await writeClipboardText(renderedHtmlToMarkdown(html, baseUrl));
        app.notify("Copied as Markdown");
      } else {
        // Plain-text alternative for targets that don't accept HTML.
        await writeClipboardHtml(renderedHtmlForClipboard(html, baseUrl), renderedHtmlToMarkdown(html, baseUrl) || wiki);
        app.notify("Copied with formatting");
      }
    } catch (e) {
      app.notify(`Copy failed: ${errorMessage(e)}`, "error");
    } finally {
      setCopying(null);
    }
  }
  const [transitioning, setTransitioning] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const comments = useMemo((): Array<{ c: Comment; html: string }> => {
    const list = f?.comment?.comments ?? [];
    const renderedList = rendered?.comment?.comments ?? [];
    const byId = new Map<string, string>();
    renderedList.forEach((r, i) => byId.set(r.id ?? String(i), r.body));
    const out = list.map((c, i) => ({
      c,
      html: byId.get(c.id) ?? renderedList[i]?.body ?? c.renderedBody ?? escapePlain(c.body),
    }));
    return newestFirst ? out.reverse() : out;
  }, [f, rendered, newestFirst]);

  const links = useMemo(() => {
    const out: Array<{ label: string; issue: LinkedIssue }> = [];
    for (const l of f?.issuelinks ?? []) {
      if (l.outwardIssue) out.push({ label: l.type.outward, issue: l.outwardIssue });
      if (l.inwardIssue) out.push({ label: l.type.inward, issue: l.inwardIssue });
    }
    return out;
  }, [f]);

  const transitions: Transition[] = issue?.transitions ?? [];

  const icon = (url: string | undefined): string | null => (url ? (toAssetUrl(url, baseUrl) ?? url) : null);

  async function openInBrowser() {
    if (!issue) return;
    try {
      await openUrl(toJiraUrl(`browse/${issue.key}`, baseUrl));
    } catch (e) {
      app.notify(errorMessage(e), "error");
    }
  }

  async function transition(e: ChangeEvent<HTMLSelectElement>) {
    const select = e.target;
    const id = select.value;
    select.value = "";
    if (!id || !issue) return;
    setTransitioning(true);
    try {
      const updated = await api.doTransition(issue.key, id);
      app.applyIssue(updated);
      app.notify("Status updated");
    } catch (err) {
      app.notify(errorMessage(err), "error");
    } finally {
      setTransitioning(false);
    }
  }

  async function assignToMe() {
    if (!issue || !me) return;
    try {
      app.applyIssue(await api.assignIssue(issue.key, me.name));
      app.notify("Assigned to you");
    } catch (err) {
      app.notify(errorMessage(err), "error");
    }
  }

  async function toggleFullscreen() {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  }

  function scrollToComments() {
    scroller.current?.querySelector("#comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openAttachment(a: Attachment) {
    const images = (f?.attachment ?? []).filter(isImage);
    if (!isImage(a)) {
      void openUrl(a.content).catch((e) => app.notify(errorMessage(e), "error"));
      return;
    }
    app.openLightbox(
      images.map((img) => ({ src: toAssetUrl(img.content, baseUrl) ?? img.content, title: img.filename, href: img.content })),
      images.indexOf(a),
    );
  }

  // Reset scroll when switching issues.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [selectedKey]);

  const lozenge = (cat: string | undefined) => `lozenge ${cat ?? ""}`;

  return (
    <section className={`${css.view} ${focus ? css.focus : ""}`}>
      {!selectedKey ? (
        <div className={`${css.empty} muted`}>
          <div className={css.big}>Select an issue</div>
          <div>
            Use <kbd>j</kbd>/<kbd>k</kbd> to move, <kbd>f</kbd> for focus mode, <kbd>/</kbd> to search, <kbd>?</kbd> for all
            shortcuts.
          </div>
        </div>
      ) : (
        <>
          <div className={css.toolbar}>
            <button className="ghost" onClick={() => app.back()} disabled={!historyLength} title="Back (u)">
              ←
            </button>
            {onBoard ? (
              <button className="ghost" onClick={() => app.closeIssue()} title="Back to board (Esc)">
                ▦ Board
              </button>
            ) : (
              focus && (
                <button className="ghost" onClick={() => app.setFocus(false)} title="Exit focus mode (Esc)">
                  ☰ List
                </button>
              )
            )}
            <span className={`${css.crumb} muted`}>
              {f?.project && (
                <>
                  <span>{f.project.name}</span>
                  <span className={css.sep}>/</span>
                </>
              )}
              {f?.parent && (
                <>
                  <button className={css.link} onClick={() => f.parent && app.openIssue(f.parent.key)}>
                    {f.parent.key}
                  </button>
                  <span className={css.sep}>/</span>
                </>
              )}
              <span className={`mono ${css.key}`}>{selectedKey}</span>
            </span>
            <span className={css.grow}></span>
            {issueLoading ? (
              <span className="spin" title="Refreshing…"></span>
            ) : issueFromCache ? (
              <span className={`muted ${css.tiny}`} title="Showing cached copy; refresh failed or pending">
                cached
              </span>
            ) : null}
            <button className="ghost" onClick={() => app.editIssue()} title="Edit summary, description and fields (e)">
              ✎ Edit
            </button>
            <button className="ghost" onClick={() => app.refreshIssue()} title="Refresh (r)">
              ↻
            </button>
            <button className="ghost" onClick={scrollToComments} title="Jump to comments">
              💬 {f?.comment?.total ?? f?.comment?.comments?.length ?? 0}
            </button>
            <button
              className={`ghost ${focus ? css.on : ""}`}
              onClick={() => app.toggleFocus()}
              title="Focus mode: hide list & sidebar (f)"
            >
              {focus ? "⤡ Focus" : "⤢ Focus"}
            </button>
            <button className="ghost" onClick={toggleFullscreen} title="Toggle fullscreen (F11)">
              ⛶
            </button>
            <button className="ghost" onClick={openInBrowser} title="Open in browser">
              ↗
            </button>
          </div>

          <div className={css.scroller} ref={scroller}>
            {issueError && !issue ? (
              <div className={css.content}>
                <div className={css.error}>{issueError}</div>
              </div>
            ) : !issue || !f ? (
              <div className={`${css.content} muted`}>Loading {selectedKey}…</div>
            ) : (
              <div className={css.content}>
                <h1 className={css.summary}>
                  {icon(f.issuetype?.iconUrl) && (
                    <img className={css.typeicon} src={icon(f.issuetype?.iconUrl) ?? undefined} alt="" title={f.issuetype?.name} />
                  )}
                  {f.summary}
                </h1>

                <div className={css.meta}>
                  <div className={css.field}>
                    <span className={css.label}>Status</span>
                    <span className={`${css.value} ${css.status}`}>
                      <span className={lozenge(f.status?.statusCategory?.key)}>{f.status?.name ?? "—"}</span>
                      {transitions.length > 0 && (
                        <select className={css.transition} onChange={transition} disabled={transitioning} value="">
                          <option value="" disabled>
                            {transitioning ? "Updating…" : "Transition…"}
                          </option>
                          {transitions.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                              {t.to ? ` → ${t.to.name}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </span>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>Assignee</span>
                    <span className={css.value}>
                      {f.assignee ? (
                        <>
                          <Avatar user={f.assignee} size={20} /> {f.assignee.displayName}
                        </>
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                      {me && f.assignee?.name !== me.name && (
                        <button className={`${css.link} ${css.small}`} onClick={assignToMe}>
                          assign to me
                        </button>
                      )}
                    </span>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>Reporter</span>
                    <span className={css.value}>
                      {f.reporter ? (
                        <>
                          <Avatar user={f.reporter} size={20} /> {f.reporter.displayName}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>Priority</span>
                    <span className={css.value}>
                      {f.priority ? (
                        <>
                          {icon(f.priority.iconUrl) && <img className={css.icon16} src={icon(f.priority.iconUrl) ?? undefined} alt="" />}
                          {f.priority.name}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>Type</span>
                    <span className={css.value}>{f.issuetype?.name ?? "—"}</span>
                  </div>
                  {f.resolution && (
                    <div className={css.field}>
                      <span className={css.label}>Resolution</span>
                      <span className={css.value}>{f.resolution.name}</span>
                    </div>
                  )}
                  {f.labels && f.labels.length > 0 && (
                    <div className={css.field}>
                      <span className={css.label}>Labels</span>
                      <span className={`${css.value} ${css.tags}`}>
                        {f.labels.map((l) => (
                          <span key={l} className={css.tag}>
                            {l}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {f.components && f.components.length > 0 && (
                    <div className={css.field}>
                      <span className={css.label}>Components</span>
                      <span className={`${css.value} ${css.tags}`}>
                        {f.components.map((c) => (
                          <span key={c.name} className={css.tag}>
                            {c.name}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {f.fixVersions && f.fixVersions.length > 0 && (
                    <div className={css.field}>
                      <span className={css.label}>Fix versions</span>
                      <span className={`${css.value} ${css.tags}`}>
                        {f.fixVersions.map((v) => (
                          <span key={v.name} className={css.tag}>
                            {v.name}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {f.duedate && (
                    <div className={css.field}>
                      <span className={css.label}>Due</span>
                      <span className={css.value}>{f.duedate}</span>
                    </div>
                  )}
                  <div className={css.field}>
                    <span className={css.label}>Created</span>
                    <span className={css.value} title={absoluteTime(f.created)}>
                      {relativeTime(f.created)}
                    </span>
                  </div>
                  <div className={css.field}>
                    <span className={css.label}>Updated</span>
                    <span className={css.value} title={absoluteTime(f.updated)}>
                      {relativeTime(f.updated)}
                    </span>
                  </div>
                </div>

                <h2 className={css.h2}>
                  Description
                  {(rendered?.description || f.description) && (
                    <>
                      <span className={css.grow}></span>
                      <span className={css.copyGroup} role="group" aria-label="Copy description">
                        <button className={`ghost ${css.small}`} onClick={() => void copyDescription("html")} disabled={copying !== null} title="Copy with formatting (rich text)">
                          {copying === "html" ? <span className="spin"></span> : "⎘"} Copy
                        </button>
                        <button className={`ghost ${css.small}`} onClick={() => void copyDescription("wiki")} disabled={copying !== null} title="Copy as raw Jira wiki markup">
                          {copying === "wiki" && <span className="spin"></span>} Jira markup
                        </button>
                        <button className={`ghost ${css.small}`} onClick={() => void copyDescription("md")} disabled={copying !== null} title="Copy as Markdown">
                          {copying === "md" && <span className="spin"></span>} Markdown
                        </button>
                      </span>
                    </>
                  )}
                </h2>
                {rendered?.description || f.description ? (
                  <JiraHtml html={rendered?.description ?? escapePlain(f.description ?? "")} className="description" />
                ) : (
                  <p className="muted">No description.</p>
                )}

                {(rendered?.environment || f.environment) && (
                  <>
                    <h2 className={css.h2}>Environment</h2>
                    <JiraHtml html={rendered?.environment ?? escapePlain(f.environment ?? "")} />
                  </>
                )}

                {f.attachment && f.attachment.length > 0 && (
                  <>
                    <h2 className={css.h2}>
                      Attachments <span className={`muted ${css.count}`}>{f.attachment.length}</span>
                    </h2>
                    <div className={css.attachments}>
                      {f.attachment.map((a) => (
                        <button
                          key={a.id}
                          className={`${css.attachment} ${isImage(a) ? css.image : ""}`}
                          title={`${a.filename} · ${formatBytes(a.size)} · ${a.author?.displayName ?? ""}`}
                          onClick={() => openAttachment(a)}
                        >
                          {a.thumbnail && icon(a.thumbnail) ? (
                            <img src={icon(a.thumbnail) ?? undefined} alt={a.filename} loading="lazy" />
                          ) : (
                            <span className={css.file}>{a.mimeType.split("/")[1]?.slice(0, 5) ?? "file"}</span>
                          )}
                          <span className={css.fname}>{a.filename}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {((f.subtasks && f.subtasks.length > 0) || links.length > 0) && (
                  <>
                    <h2 className={css.h2}>Linked issues</h2>
                    <ul className={css.links}>
                      {(f.subtasks ?? []).map((s) => (
                        <li key={s.id}>
                          <span className={`muted ${css.rel}`}>subtask</span>
                          <button className={`${css.link} mono`} onClick={() => app.openIssue(s.key)}>
                            {s.key}
                          </button>
                          <span className={`${css.lsum} ${s.fields.status?.statusCategory?.key === "done" ? css.done : ""}`}>
                            {s.fields.summary}
                          </span>
                          <span className={lozenge(s.fields.status?.statusCategory?.key)}>{s.fields.status?.name ?? ""}</span>
                        </li>
                      ))}
                      {links.map((l) => (
                        <li key={l.issue.id + l.label}>
                          <span className={`muted ${css.rel}`}>{l.label}</span>
                          <button className={`${css.link} mono`} onClick={() => app.openIssue(l.issue.key)}>
                            {l.issue.key}
                          </button>
                          <span className={`${css.lsum} ${l.issue.fields.status?.statusCategory?.key === "done" ? css.done : ""}`}>
                            {l.issue.fields.summary}
                          </span>
                          <span className={lozenge(l.issue.fields.status?.statusCategory?.key)}>{l.issue.fields.status?.name ?? ""}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h2 className={css.h2} id="comments">
                  Comments <span className={`muted ${css.count}`}>{comments.length}</span>
                  <span className={css.grow}></span>
                  <button className={`ghost ${css.small}`} onClick={() => setNewestFirst((v) => !v)}>
                    {newestFirst ? "Newest first" : "Oldest first"} ⇅
                  </button>
                </h2>
                {!comments.length && <p className="muted">No comments yet.</p>}
                <div className={css.comments}>
                  {comments.map(({ c, html }) => (
                    <article key={c.id} className={css.comment}>
                      <header className={css.commentHeader}>
                        {c.author && <Avatar user={c.author} size={28} />}
                        <span className={css.author}>{c.author?.displayName ?? "Anonymous"}</span>
                        <span className={`muted ${css.when}`} title={absoluteTime(c.created)}>
                          {relativeTime(c.created)}
                        </span>
                        {c.updated && c.updated !== c.created && (
                          <span className={`muted ${css.when}`} title={absoluteTime(c.updated)}>
                            (edited)
                          </span>
                        )}
                        {c.visibility && (
                          <span className="lozenge" title="Restricted comment">
                            🔒 {c.visibility.value}
                          </span>
                        )}
                      </header>
                      <JiraHtml html={html} className={css.body} />
                    </article>
                  ))}
                </div>

                <CommentBox issueKey={issue.key} />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
