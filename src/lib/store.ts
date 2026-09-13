import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { api, errorMessage, swr } from "./api";
import { columnsOf, doneWindowJql, groupByColumn, loadDoneWindow, saveDoneWindow, type DoneWindow } from "./board";
import type { Board, BoardConfig, Filter, Issue, JiraUser, Project, PublicSettings, SearchResult, SettingsInput } from "./types";

export interface QuickView {
  id: string;
  name: string;
  jql: string;
}

export const QUICK_VIEWS: QuickView[] = [
  { id: "mine", name: "My open issues", jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "reported", name: "Reported by me", jql: "reporter = currentUser() ORDER BY created DESC" },
  { id: "watched", name: "Watched", jql: "watcher = currentUser() AND resolution = Unresolved ORDER BY updated DESC" },
  { id: "recent", name: "Recently viewed", jql: "issuekey in issueHistory() ORDER BY lastViewed DESC" },
  { id: "updated", name: "Recently updated", jql: "updated >= -7d ORDER BY updated DESC" },
];

const PAGE_SIZE = 50;
export const ISSUE_KEY_RE = /^\s*([A-Za-z][A-Za-z0-9_]+-\d+)\s*$/;
const JQL_HINT_RE = /(=|!=|~|\bORDER BY\b|\bAND\b|\bOR\b|\bIN\b|\bIS\b|>=|<=)/i;

export type Screen = "loading" | "connect" | "main";

/** What the middle of the window shows: a search result list or a kanban board. */
export type View = "list" | "board";

/** Full-window editor: edit an existing issue or create a new one. */
export type EditorMode = { kind: "edit"; key: string } | { kind: "create"; projectKey: string | null };

/** One image shown fullscreen by the lightbox. */
export interface LightboxItem {
  /** Webview-loadable URL (jira-asset protocol for Jira-hosted files). */
  src: string;
  title: string;
  /** Browser URL for "open in browser" / download. */
  href?: string;
}

export interface Toast {
  text: string;
  kind: "info" | "error";
}

export interface AppState {
  screen: Screen;
  settings: PublicSettings | null;
  me: JiraUser | null;

  filters: Filter[];
  projects: Project[];
  boards: Board[];
  /** Board id -> keys of the projects it belongs to (resolved when `location` is missing). */
  boardProjects: Record<number, string[]>;

  view: View;
  /** Active board in board view; `issues` then holds its cards in column order. */
  board: Board | null;
  boardConfig: BoardConfig | null;
  doneWindow: DoneWindow;

  jql: string;
  viewId: string;
  viewName: string;
  issues: Issue[];
  total: number;
  listLoading: boolean;
  listFromCache: boolean;
  listError: string | null;

  selectedKey: string | null;
  issue: Issue | null;
  issueLoading: boolean;
  issueFromCache: boolean;
  issueError: string | null;
  history: string[];

  /** Focus mode hides the sidebar and list so description + comments get the whole window. */
  focus: boolean;
  sidebarOpen: boolean;
  editor: EditorMode | null;
  lightbox: { items: LightboxItem[]; index: number } | null;
  toast: Toast | null;
}

const initial: AppState = {
  screen: "loading",
  settings: null,
  me: null,
  filters: [],
  projects: [],
  boards: [],
  boardProjects: {},
  view: "list",
  board: null,
  boardConfig: null,
  doneWindow: loadDoneWindow(),
  jql: QUICK_VIEWS[0].jql,
  viewId: QUICK_VIEWS[0].id,
  viewName: QUICK_VIEWS[0].name,
  issues: [],
  total: 0,
  listLoading: false,
  listFromCache: false,
  listError: null,
  selectedKey: null,
  issue: null,
  issueLoading: false,
  issueFromCache: false,
  issueError: null,
  history: [],
  focus: false,
  sidebarOpen: true,
  editor: null,
  lightbox: null,
  toast: null,
};

export const useApp = create<AppState>()(() => initial);

const { getState: get, setState: set } = useApp;

/** Select several fields at once with shallow comparison. */
export function useAppShallow<T>(selector: (s: AppState) => T): T {
  return useApp(useShallow(selector));
}

export function baseUrl(): string {
  return get().settings?.base_url ?? "";
}

export function useBaseUrl(): string {
  return useApp((s) => s.settings?.base_url ?? "");
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;
let issueSeq = 0;

function selectedIndex(): number {
  const { issues, selectedKey } = get();
  return issues.findIndex((i) => i.key === selectedKey);
}

function pickListFields(issue: Issue) {
  const f = issue.fields;
  return {
    summary: f.summary,
    status: f.status,
    issuetype: f.issuetype,
    priority: f.priority,
    assignee: f.assignee,
    updated: f.updated,
    labels: f.labels,
    resolution: f.resolution,
  };
}

function prefetchNeighbours(key: string) {
  const issues = get().issues;
  const idx = issues.findIndex((i) => i.key === key);
  if (idx < 0) return;
  void api.prefetchIssues(issues.slice(Math.max(0, idx - 2), idx + 4).map((i) => i.key));
}

export const app = {
  get state() {
    return get();
  },

  notify(text: string, kind: "info" | "error" = "info") {
    set({ toast: { text, kind } });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), kind === "error" ? 6000 : 2500);
  },

  async init() {
    let settings: PublicSettings | null = null;
    try {
      settings = await api.getSettings();
    } catch (e) {
      console.error(e);
    }
    set({ settings });
    if (!settings) {
      set({ screen: "connect" });
      return;
    }
    set({ screen: "main" });
    // Everything below is stale-while-revalidate: cached data shows instantly.
    void app.loadSidebar();
    const { jql, viewId, viewName } = get();
    void app.runSearch(jql, viewId, viewName);
    api.getMyself().then(
      (me) => set({ me }),
      (e) => app.notify(`Jira unreachable: ${errorMessage(e)}`, "error"),
    );
    void api.onIssueCached((key) => {
      const s = get();
      if (key === s.selectedKey && !s.issue) void app.openIssue(key, { push: false });
    });
  },

  async connect(input: SettingsInput): Promise<void> {
    const me = await api.connect(input);
    const settings = await api.getSettings();
    set({ me, settings, screen: "main" });
    void app.loadSidebar();
    void app.runSearch(QUICK_VIEWS[0].jql, QUICK_VIEWS[0].id, QUICK_VIEWS[0].name);
  },

  async disconnect() {
    await api.disconnect();
    set({
      settings: null,
      me: null,
      issues: [],
      issue: null,
      selectedKey: null,
      filters: [],
      projects: [],
      boards: [],
      boardProjects: {},
      view: "list",
      board: null,
      boardConfig: null,
      screen: "connect",
    });
  },

  async loadSidebar() {
    await Promise.allSettled([
      swr(api.getFavouriteFilters, (filters) => set({ filters })),
      swr(api.getProjects, (projects) => set({ projects })),
      swr(api.getBoards, (boards) => {
        set({ boards });
        void app.resolveBoardProjects(boards);
      }),
    ]);
  },

  /** Jira Server boards usually come without `location`; ask the Agile API which projects they cover. */
  async resolveBoardProjects(boards: Board[]) {
    const pending = boards.filter((b) => !b.location?.projectKey && !(b.id in get().boardProjects));
    await Promise.allSettled(
      pending.map((b) =>
        swr(
          (pc) => api.getBoardProjects(b.id, pc),
          (projects) => set((s) => ({ boardProjects: { ...s.boardProjects, [b.id]: projects.map((p) => p.key) } })),
        ),
      ),
    );
  },

  async runSearch(jql: string, viewId = "custom", viewName = "Search") {
    const seq = ++searchSeq;
    set({ view: "list", jql, viewId, viewName, listError: null, listLoading: true });
    let gotAny = false;
    try {
      await swr<SearchResult>(
        (pc) => api.searchIssues(jql, 0, PAGE_SIZE, pc),
        (res, fromCache) => {
          if (seq !== searchSeq) return;
          gotAny = true;
          set({ issues: res.issues, total: res.total, listFromCache: fromCache });
          if (!fromCache) void api.prefetchIssues(res.issues.slice(0, 15).map((i) => i.key));
        },
      );
    } catch (e) {
      if (seq !== searchSeq) return;
      set({ listError: errorMessage(e) });
      if (!gotAny) set({ issues: [], total: 0 });
    } finally {
      if (seq === searchSeq) set({ listLoading: false });
    }
  },

  /**
   * Show a kanban board: its column configuration (cached, then fresh) and
   * every issue on it, with the last column limited to `doneWindow`.
   */
  async openBoard(board: Board) {
    const seq = ++searchSeq;
    const s = get();
    set({
      view: "board",
      board,
      boardConfig: s.board?.id === board.id ? s.boardConfig : null,
      viewId: `board:${board.id}`,
      viewName: board.name,
      jql: "",
      listError: null,
      listLoading: true,
    });
    let loadedFor: string | null = null;
    const loadIssues = (config: BoardConfig) => {
      const jql = doneWindowJql(columnsOf(config), get().doneWindow);
      if (jql === loadedFor) return;
      loadedFor = jql;
      void app.loadBoardIssues(seq, board.id, config, jql);
    };
    try {
      await swr<BoardConfig>(
        (pc) => api.getBoardConfiguration(board.id, pc),
        (config) => {
          if (seq !== searchSeq) return;
          set({ boardConfig: config, jql: doneWindowJql(columnsOf(config), get().doneWindow) });
          loadIssues(config);
        },
      );
    } catch (e) {
      if (seq !== searchSeq) return;
      set({ listError: errorMessage(e), listLoading: false, issues: [], total: 0 });
    }
  },

  async loadBoardIssues(seq: number, boardId: number, config: BoardConfig, jql: string) {
    const columns = columnsOf(config);
    let gotAny = false;
    set({ listLoading: true });
    try {
      await swr<SearchResult>(
        (pc) => api.getBoardIssues(boardId, jql, pc),
        (res, fromCache) => {
          if (seq !== searchSeq) return;
          gotAny = true;
          set({ issues: groupByColumn(res.issues, columns).flat(), total: res.total, listFromCache: fromCache });
          if (!fromCache) void api.prefetchIssues(res.issues.slice(0, 15).map((i) => i.key));
        },
      );
    } catch (e) {
      if (seq !== searchSeq) return;
      set({ listError: errorMessage(e) });
      if (!gotAny) set({ issues: [], total: 0 });
    } finally {
      if (seq === searchSeq) set({ listLoading: false });
    }
  },

  setDoneWindow(doneWindow: DoneWindow) {
    if (doneWindow === get().doneWindow) return;
    set({ doneWindow });
    saveDoneWindow(doneWindow);
    const { view, board } = get();
    if (view === "board" && board) void app.openBoard(board);
  },

  async loadMore() {
    const s = get();
    if (s.view === "board" || s.listLoading || s.issues.length >= s.total) return;
    const seq = searchSeq;
    set({ listLoading: true });
    try {
      const res = await api.searchIssues(s.jql, s.issues.length, PAGE_SIZE, false);
      if (seq !== searchSeq || !res) return;
      const cur = get().issues;
      const seen = new Set(cur.map((i) => i.key));
      set({ issues: [...cur, ...res.value.issues.filter((i) => !seen.has(i.key))], total: res.value.total });
      void api.prefetchIssues(res.value.issues.slice(0, 10).map((i) => i.key));
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      if (seq === searchSeq) set({ listLoading: false });
    }
  },

  refreshList() {
    const { view, board, jql, viewId, viewName } = get();
    if (view === "board" && board) return app.openBoard(board);
    return app.runSearch(jql, viewId, viewName);
  },

  /** Quick search box: issue key → open it; JQL-looking → run it; else full text. */
  quickSearch(text: string) {
    const t = text.trim();
    if (!t) return;
    const km = t.match(ISSUE_KEY_RE);
    if (km) {
      void app.openIssue(km[1].toUpperCase());
      return;
    }
    if (JQL_HINT_RE.test(t)) {
      void app.runSearch(t, "custom", "JQL");
      return;
    }
    const escaped = t.replace(/(["\\])/g, "\\$1");
    void app.runSearch(`text ~ "${escaped}" ORDER BY updated DESC`, "custom", `Search: ${t}`);
  },

  async openIssue(key: string, opts: { push?: boolean } = {}) {
    const push = opts.push ?? true;
    const s = get();
    if (push && s.selectedKey && s.selectedKey !== key) {
      set({ history: [...s.history.slice(-49), s.selectedKey] });
    }
    const seq = ++issueSeq;
    set({ selectedKey: key, issueError: null, issueLoading: true, issue: s.issue?.key === key ? s.issue : null });
    try {
      await swr<Issue>(
        (pc) => api.getIssue(key, pc),
        (issue, fromCache) => {
          if (seq !== issueSeq) return;
          set({ issue, issueFromCache: fromCache, issueError: null });
          if (fromCache) prefetchNeighbours(key);
        },
      );
    } catch (e) {
      if (seq !== issueSeq) return;
      set({ issueError: errorMessage(e) });
    } finally {
      if (seq === issueSeq) set({ issueLoading: false });
    }
  },

  async refreshIssue() {
    const key = get().selectedKey;
    if (!key) return;
    const seq = ++issueSeq;
    set({ issueLoading: true });
    try {
      const fresh = await api.getIssue(key, false);
      if (seq === issueSeq && fresh) set({ issue: fresh.value, issueFromCache: false });
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      if (seq === issueSeq) set({ issueLoading: false });
    }
  },

  /** Replace the current issue (after a write) and patch the list row. */
  applyIssue(issue: Issue | null) {
    if (!issue) return;
    const s = get();
    set({
      issue: s.selectedKey === issue.key ? issue : s.issue,
      issues: s.issues.map((i) => (i.key === issue.key ? { ...i, fields: { ...i.fields, ...pickListFields(issue) } } : i)),
    });
  },

  back() {
    const history = get().history;
    const prev = history.at(-1);
    if (!prev) return;
    set({ history: history.slice(0, -1) });
    void app.openIssue(prev, { push: false });
  },

  closeIssue() {
    set({ selectedKey: null, issue: null, focus: false });
  },

  selectRelative(delta: number) {
    const { issues, selectedKey } = get();
    if (!issues.length) return;
    const idx = selectedIndex();
    const next = idx < 0 ? 0 : Math.min(issues.length - 1, Math.max(0, idx + delta));
    const key = issues[next]?.key;
    if (key && key !== selectedKey) void app.openIssue(key, { push: false });
    if (next >= issues.length - 5) void app.loadMore();
  },

  setFocus(focus: boolean) {
    set({ focus });
  },

  toggleFocus() {
    set({ focus: !get().focus });
  },

  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },

  editIssue(key = get().selectedKey) {
    if (key) set({ editor: { kind: "edit", key } });
  },

  newIssue(projectKey: string | null = get().issue?.fields.project?.key ?? null) {
    set({ editor: { kind: "create", projectKey } });
  },

  closeEditor() {
    set({ editor: null });
  },

  openLightbox(items: LightboxItem[], index = 0) {
    if (!items.length) return;
    set({ lightbox: { items, index: Math.max(0, Math.min(index, items.length - 1)) } });
  },

  setLightboxIndex(index: number) {
    const lb = get().lightbox;
    if (lb) set({ lightbox: { ...lb, index } });
  },

  closeLightbox() {
    set({ lightbox: null });
  },

  /** After `create_issue`: show the new issue and put it at the top of the list. */
  addCreatedIssue(issue: Issue) {
    const s = get();
    if (!s.issues.some((i) => i.key === issue.key)) {
      set({ issues: [issue, ...s.issues], total: s.total + 1 });
    }
    void app.openIssue(issue.key);
  },
};
