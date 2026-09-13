import { useState } from "react";
import { app, QUICK_VIEWS, useApp, useBaseUrl } from "../lib/store";
import { errorMessage } from "../lib/api";
import css from "./Sidebar.module.css";

export default function Sidebar() {
  const me = useApp((s) => s.me);
  const filters = useApp((s) => s.filters);
  const projects = useApp((s) => s.projects);
  const boards = useApp((s) => s.boards);
  const viewId = useApp((s) => s.viewId);
  const baseUrl = useBaseUrl();
  const [showAllProjects, setShowAllProjects] = useState(false);
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 12);

  function pickView(id: string, name: string, jql: string) {
    void app.runSearch(jql, id, name);
  }

  async function disconnect() {
    if (!confirm("Disconnect and forget the stored credentials?")) return;
    try {
      await app.disconnect();
    } catch (e) {
      app.notify(errorMessage(e), "error");
    }
  }

  const item = (active: boolean) => `${css.item} ${active ? css.active : ""}`;

  return (
    <nav className={css.sidebar}>
      <div className={css.brand}>
        <span className={css.logo}>jirafast</span>
        {me && (
          <span className={`${css.me} muted`} title={me.emailAddress ?? me.name}>
            {me.displayName}
          </span>
        )}
      </div>

      <div className={css.section}>
        <h3>Views</h3>
        {QUICK_VIEWS.map((v) => (
          <button key={v.id} className={item(viewId === v.id)} onClick={() => pickView(v.id, v.name, v.jql)}>
            {v.name}
          </button>
        ))}
      </div>

      {filters.length > 0 && (
        <div className={css.section}>
          <h3>Favourite filters</h3>
          {filters.map((f) => (
            <button
              key={f.id}
              className={item(viewId === `filter:${f.id}`)}
              title={f.jql}
              onClick={() => pickView(`filter:${f.id}`, f.name, f.jql)}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      {boards.length > 0 && (
        <div className={css.section}>
          <h3>Boards</h3>
          {boards.map((b) => (
            <button
              key={b.id}
              className={item(viewId === `board:${b.id}`)}
              title={b.location?.displayName ?? b.name}
              onClick={() => app.openBoard(b)}
            >
              <span className={`${css.pkey} ${css.btype}`}>{b.type === "scrum" ? "scrum" : "kanban"}</span>
              <span className={css.pname}>{b.name}</span>
            </button>
          ))}
        </div>
      )}

      {projects.length > 0 && (
        <div className={css.section}>
          <h3>Projects</h3>
          {visibleProjects.map((p) => (
            <button
              key={p.id}
              className={item(viewId === `project:${p.key}`)}
              title={p.name}
              onClick={() =>
                pickView(`project:${p.key}`, p.name, `project = "${p.key}" AND resolution = Unresolved ORDER BY updated DESC`)
              }
            >
              <span className={`${css.pkey} mono`}>{p.key}</span>
              <span className={css.pname}>{p.name}</span>
            </button>
          ))}
          {projects.length > 12 && (
            <button className={`${css.item} ${css.more} muted`} onClick={() => setShowAllProjects((v) => !v)}>
              {showAllProjects ? "Show fewer" : `Show all ${projects.length}`}
            </button>
          )}
        </div>
      )}

      <div className={css.spacer}></div>
      <div className={css.footer}>
        <span className={`muted ${css.host}`} title={baseUrl}>
          {baseUrl.replace(/^https?:\/\//, "")}
        </span>
        <button className={`ghost ${css.small}`} onClick={disconnect} title="Disconnect">
          Sign out
        </button>
      </div>
    </nav>
  );
}
