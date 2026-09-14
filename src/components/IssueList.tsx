import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { app, useApp, useAppShallow, useBaseUrl } from "../lib/store";
import { relativeTime } from "../lib/format";
import { toAssetUrl } from "../lib/html";
import Avatar from "./Avatar";
import css from "./IssueList.module.css";

export default function IssueList({ searchBox }: { searchBox: RefObject<HTMLInputElement | null> }) {
  const baseUrl = useBaseUrl();
  const issues = useApp((s) => s.issues);
  const selectedKey = useApp((s) => s.selectedKey);
  const { jql, viewName, scopeProject, total, listLoading, listError } = useAppShallow((s) => ({
    jql: s.jql,
    viewName: s.viewName,
    scopeProject: s.scopeProject,
    total: s.total,
    listLoading: s.listLoading,
    listError: s.listError,
  }));
  const [query, setQuery] = useState("");
  const listEl = useRef<HTMLDivElement>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    app.quickSearch(query);
    searchBox.current?.blur();
  }

  function onScroll() {
    const el = listEl.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) void app.loadMore();
  }

  // Keep the selected row visible when navigating with the keyboard.
  useEffect(() => {
    if (!selectedKey || !listEl.current) return;
    listEl.current.querySelector<HTMLElement>(`[data-key="${selectedKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const icon = (url: string | undefined): string | null => (url ? (toAssetUrl(url, baseUrl) ?? url) : null);

  return (
    <section className={css.listPane}>
      <header className={css.header}>
        <form className={`${css.search} ${scopeProject ? css.scoped : ""}`} onSubmit={submit}>
          {scopeProject && (
            <button
              type="button"
              className={`${css.scope} mono`}
              title={`Searching only in ${scopeProject} — click to search all projects`}
              onClick={() => app.clearScope()}
            >
              {scopeProject}
              <span className={css.scopeX}>×</span>
            </button>
          )}
          <input
            ref={searchBox}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder={scopeProject ? `Search in ${scopeProject}…  ( / )` : "Search text, issue key or JQL…  ( / )"}
            spellCheck={false}
          />
        </form>
        <div className={css.title}>
          <span className={css.name} title={jql}>
            {viewName}
          </span>
          <span className={`${css.count} muted`}>
            {listLoading && <span className="spin"></span>}
            {total ? `${issues.length} / ${total}` : listLoading ? "" : "0"}
          </span>
          <button className={`ghost ${css.icon}`} title="Refresh (r)" onClick={() => app.refreshList()}>
            ↻
          </button>
          <button className={`ghost ${css.icon}`} title="New issue (n)" onClick={() => app.newIssue()}>
            ＋
          </button>
        </div>
      </header>

      {listError && <div className={css.error}>{listError}</div>}

      <div className={css.rows} ref={listEl} onScroll={onScroll}>
        {issues.map((issue) => {
          const f = issue.fields;
          const cat = f.status?.statusCategory?.key ?? "";
          const done = cat === "done" || !!f.resolution;
          const typeIcon = icon(f.issuetype?.iconUrl);
          const prioIcon = f.priority ? icon(f.priority.iconUrl) : null;
          return (
            <button
              key={issue.key}
              className={`${css.row} ${issue.key === selectedKey ? css.active : ""} ${done ? css.done : ""}`}
              data-key={issue.key}
              onClick={() => app.openIssue(issue.key)}
            >
              <div className={css.line1}>
                {typeIcon && <img className={css.type} src={typeIcon} alt={f.issuetype?.name ?? ""} title={f.issuetype?.name} />}
                <span className={`${css.key} mono`}>{issue.key}</span>
                {f.priority && prioIcon && <img className={css.prio} src={prioIcon} alt={f.priority.name} title={f.priority.name} />}
                <span className={css.grow}></span>
                <span className={`lozenge ${cat}`}>{f.status?.name ?? ""}</span>
              </div>
              <div className={css.summary}>{f.summary}</div>
              <div className={`${css.line3} muted`}>
                {f.assignee ? (
                  <>
                    <Avatar user={f.assignee} size={16} />
                    <span className={css.assignee}>{f.assignee.displayName}</span>
                  </>
                ) : (
                  <span className={css.assignee}>Unassigned</span>
                )}
                <span className={css.grow}></span>
                <span title={f.updated}>{relativeTime(f.updated)}</span>
              </div>
            </button>
          );
        })}
        {!issues.length && !listLoading && !listError && <div className={`${css.empty} muted`}>No issues match.</div>}
        {issues.length > 0 && issues.length < total && (
          <button className={`ghost ${css.more}`} onClick={() => app.loadMore()} disabled={listLoading}>
            {listLoading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  );
}
