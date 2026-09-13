import { useEffect, useMemo, useState } from "react";
import { app, QUICK_VIEWS, useApp, useBaseUrl } from "../lib/store";
import { errorMessage } from "../lib/api";
import { groupBoards, loadOpenFolders, saveOpenFolders, type ProjectFolder } from "../lib/board";
import css from "./Sidebar.module.css";

const PROJECT_LIMIT = 12;

export default function Sidebar() {
  const me = useApp((s) => s.me);
  const filters = useApp((s) => s.filters);
  const projects = useApp((s) => s.projects);
  const boards = useApp((s) => s.boards);
  const boardProjects = useApp((s) => s.boardProjects);
  const viewId = useApp((s) => s.viewId);
  const baseUrl = useBaseUrl();
  const [showAllProjects, setShowAllProjects] = useState(false);
  const folders = useMemo(() => groupBoards(boards, projects, boardProjects), [boards, projects, boardProjects]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(loadOpenFolders);
  const activeBoardId = viewId.startsWith("board:") ? Number(viewId.slice(6)) : null;
  const isActiveFolder = (f: ProjectFolder) => f.boards.some((b) => b.id === activeBoardId) || viewId === `project:${f.key}`;
  const visibleFolders = showAllProjects
    ? folders
    : folders.filter((f, i) => i < PROJECT_LIMIT || f.boards.length > 0 || isActiveFolder(f));

  useEffect(() => {
    const folder = folders.find((f) => f.boards.some((b) => b.id === activeBoardId) || viewId === `project:${f.key}`);
    if (folder) setOpenFolders((prev) => (prev.has(folder.key) ? prev : new Set(prev).add(folder.key)));
  }, [activeBoardId, viewId, folders]);

  function toggleFolder(key: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveOpenFolders(next);
      return next;
    });
  }

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

      {folders.length > 0 && (
        <div className={css.section}>
          <h3>Projects</h3>
          {visibleFolders.map((folder) => {
            const open = openFolders.has(folder.key);
            const p = folder.project;
            return (
              <div key={folder.key} className={css.folder}>
                <button
                  className={`${css.item} ${css.folderHead} ${isActiveFolder(folder) ? css.folderActive : ""}`}
                  aria-expanded={open}
                  title={p ? `${p.name} (${p.key})` : folder.name}
                  onClick={() => toggleFolder(folder.key)}
                >
                  <span className={`${css.chevron} ${open ? css.chevronOpen : ""}`}>▸</span>
                  {p && <span className={`${css.pkey} mono`}>{p.key}</span>}
                  <span className={css.pname}>{folder.name}</span>
                  {folder.boards.length > 0 && <span className={`${css.count} muted`}>{folder.boards.length}</span>}
                </button>
                {open && p && (
                  <button
                    className={`${item(viewId === `project:${p.key}`)} ${css.nested}`}
                    title={`Unresolved issues in ${p.name}`}
                    onClick={() =>
                      pickView(`project:${p.key}`, p.name, `project = "${p.key}" AND resolution = Unresolved ORDER BY updated DESC`)
                    }
                  >
                    <span className={`${css.pkey} ${css.btype}`}>issues</span>
                    <span className={css.pname}>Open issues</span>
                  </button>
                )}
                {open &&
                  folder.boards.map((b) => (
                    <button
                      key={b.id}
                      className={`${item(b.id === activeBoardId)} ${css.nested}`}
                      title={b.location?.displayName ?? b.name}
                      onClick={() => app.openBoard(b)}
                    >
                      <span className={`${css.pkey} ${css.btype}`}>{b.type === "scrum" ? "scrum" : "kanban"}</span>
                      <span className={css.pname}>{b.name}</span>
                    </button>
                  ))}
              </div>
            );
          })}
          {folders.length > visibleFolders.length || showAllProjects ? (
            <button className={`${css.item} ${css.more} muted`} onClick={() => setShowAllProjects((v) => !v)}>
              {showAllProjects ? "Show fewer" : `Show all ${projects.length} projects`}
            </button>
          ) : null}
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
