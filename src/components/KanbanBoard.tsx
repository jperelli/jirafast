import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { app, ISSUE_KEY_RE, useApp, useAppShallow, useBaseUrl } from "../lib/store";
import { columnsOf, DONE_WINDOWS, groupByColumn, matchesBoardQuery } from "../lib/board";
import { relativeTime } from "../lib/format";
import { toAssetUrl } from "../lib/html";
import type { Issue } from "../lib/types";
import Avatar from "./Avatar";
import css from "./KanbanBoard.module.css";

export default function KanbanBoard({ searchBox }: { searchBox: RefObject<HTMLInputElement | null> }) {
  const baseUrl = useBaseUrl();
  const issues = useApp((s) => s.issues);
  const boardConfig = useApp((s) => s.boardConfig);
  const selectedKey = useApp((s) => s.selectedKey);
  const { board, doneWindow, total, listLoading, listFromCache, listError } = useAppShallow((s) => ({
    board: s.board,
    doneWindow: s.doneWindow,
    total: s.total,
    listLoading: s.listLoading,
    listFromCache: s.listFromCache,
    listError: s.listError,
  }));
  const boardEl = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  useEffect(() => setQuery(""), [board?.id]);

  const columns = useMemo(() => columnsOf(boardConfig), [boardConfig]);
  const filtered = useMemo(() => (query.trim() ? issues.filter((i) => matchesBoardQuery(i, query)) : issues), [issues, query]);
  const grouped = useMemo(() => groupByColumn(filtered, columns), [filtered, columns]);
  const filtering = filtered.length !== issues.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    const km = query.trim().match(ISSUE_KEY_RE);
    const target = km ? km[1].toUpperCase() : filtered.length === 1 ? filtered[0].key : null;
    if (target) void app.openIssue(target);
    searchBox.current?.blur();
  }

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (query) setQuery("");
    else searchBox.current?.blur();
  }

  useEffect(() => {
    if (!selectedKey || !boardEl.current) return;
    boardEl.current.querySelector<HTMLElement>(`[data-key="${selectedKey}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  const icon = (url: string | undefined): string | null => (url ? (toAssetUrl(url, baseUrl) ?? url) : null);
  const lastIdx = columns.length - 1;

  return (
    <section className={css.board}>
      <header className={css.header}>
        <span className={css.name}>{board?.name}</span>
        {board && <span className={`${css.badge} muted`}>{board.type}</span>}
        <span className={`${css.count} muted`}>
          {listLoading && <span className="spin"></span>}
          {listLoading && !issues.length ? "" : filtering ? `${filtered.length} of ${issues.length} issues` : `${issues.length}${total > issues.length ? ` / ${total}` : ""} issues`}
          {listFromCache && !listLoading && <span title="Showing cached copy">· cached</span>}
        </span>
        <span className={css.grow}></span>
        <div className={`${css.window} muted`}>
          <span>{columns[lastIdx]?.name ?? "Done"} column:</span>
          <span className={css.segments} role="radiogroup" aria-label="Done column window">
            {DONE_WINDOWS.map((w) => (
              <button
                key={w.id}
                role="radio"
                aria-checked={doneWindow === w.id}
                className={`${css.segment} ${doneWindow === w.id ? css.on : ""}`}
                onClick={() => app.setDoneWindow(w.id)}
              >
                {w.label}
              </button>
            ))}
          </span>
        </div>
        <form className={css.search} onSubmit={submit}>
          <input
            ref={searchBox}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            type="search"
            placeholder={`Search ${board?.name ?? "board"}…  ( / )`}
            title="Filters the cards on this board by key, summary, labels, assignee, type, priority or status"
            spellCheck={false}
          />
        </form>
        <button className={`ghost ${css.icon}`} title="Refresh (r)" onClick={() => app.refreshList()}>
          ↻
        </button>
        <button className={`ghost ${css.icon}`} title="New issue (n)" onClick={() => app.newIssue()}>
          ＋
        </button>
      </header>

      {listError && <div className={css.error}>{listError}</div>}

      <div className={css.columns} ref={boardEl}>
        {columns.map((col, ci) => {
          const cards = grouped[ci] ?? [];
          const over = col.max != null && cards.length > col.max;
          const under = col.min != null && cards.length < col.min;
          return (
            <div key={`${ci}:${col.name}`} className={css.column}>
              <div className={`${css.colHeader} ${over ? css.over : ""} ${under ? css.under : ""}`}>
                <span className={css.colName}>{col.name}</span>
                <span className={`${css.colCount} muted`}>
                  {cards.length}
                  {col.max != null ? ` / ${col.max}` : ""}
                </span>
              </div>
              <div className={css.cards}>
                {cards.map((issue) => (
                  <Card key={issue.key} issue={issue} active={issue.key === selectedKey} done={ci === lastIdx} icon={icon} />
                ))}
                {!cards.length && !listLoading && (
                  <div className={`${css.emptyCol} muted`}>{filtering ? "No matches" : ci === lastIdx && doneWindow !== "all" ? "Nothing completed in this window" : "No issues"}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Card({
  issue,
  active,
  done,
  icon,
}: {
  issue: Issue;
  active: boolean;
  done: boolean;
  icon: (url: string | undefined) => string | null;
}) {
  const f = issue.fields;
  const typeIcon = icon(f.issuetype?.iconUrl);
  const prioIcon = f.priority ? icon(f.priority.iconUrl) : null;
  const when = done && f.resolutiondate ? f.resolutiondate : f.updated;
  return (
    <button className={`${css.card} ${active ? css.active : ""} ${done ? css.done : ""}`} data-key={issue.key} onClick={() => app.openIssue(issue.key)}>
      <div className={css.summary}>{f.summary}</div>
      <div className={`${css.meta} muted`}>
        {typeIcon && <img className={css.type} src={typeIcon} alt={f.issuetype?.name ?? ""} title={f.issuetype?.name} />}
        <span className={`${css.key} mono`}>{issue.key}</span>
        {f.priority && prioIcon && <img className={css.prio} src={prioIcon} alt={f.priority.name} title={f.priority.name} />}
        <span className={css.grow}></span>
        <span title={`${done && f.resolutiondate ? "Resolved" : "Updated"} ${when ?? ""}`}>{relativeTime(when)}</span>
        {f.assignee ? <Avatar user={f.assignee} size={18} /> : <span className={css.unassigned} title="Unassigned"></span>}
      </div>
      {f.labels && f.labels.length > 0 && (
        <div className={css.labels}>
          {f.labels.slice(0, 3).map((l) => (
            <span key={l} className={css.label}>
              {l}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
