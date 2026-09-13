import { api, errorMessage, swr } from "./api";
import type { Filter, Issue, JiraUser, Project, PublicSettings, SearchResult, SettingsInput } from "./types";

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
const ISSUE_KEY_RE = /^\s*([A-Za-z][A-Za-z0-9_]+-\d+)\s*$/;
const JQL_HINT_RE = /(=|!=|~|\bORDER BY\b|\bAND\b|\bOR\b|\bIN\b|\bIS\b|>=|<=)/i;

export type Screen = "loading" | "connect" | "main";

/** Full-window editor: edit an existing issue or create a new one. */
export type EditorMode = { kind: "edit"; key: string } | { kind: "create"; projectKey: string | null };

export class AppStore {
  screen = $state<Screen>("loading");
  settings = $state<PublicSettings | null>(null);
  me = $state<JiraUser | null>(null);

  filters = $state<Filter[]>([]);
  projects = $state<Project[]>([]);

  jql = $state(QUICK_VIEWS[0].jql);
  viewId = $state<string>(QUICK_VIEWS[0].id);
  viewName = $state<string>(QUICK_VIEWS[0].name);
  issues = $state<Issue[]>([]);
  total = $state(0);
  listLoading = $state(false);
  listFromCache = $state(false);
  listError = $state<string | null>(null);

  selectedKey = $state<string | null>(null);
  issue = $state<Issue | null>(null);
  issueLoading = $state(false);
  issueFromCache = $state(false);
  issueError = $state<string | null>(null);
  history = $state<string[]>([]);

  /** Focus mode hides the sidebar and list so description + comments get the whole window. */
  focus = $state(false);
  sidebarOpen = $state(true);
  editor = $state<EditorMode | null>(null);
  toast = $state<{ text: string; kind: "info" | "error" } | null>(null);

  get baseUrl(): string {
    return this.settings?.base_url ?? "";
  }

  get selectedIndex(): number {
    return this.issues.findIndex((i) => i.key === this.selectedKey);
  }

  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private searchSeq = 0;
  private issueSeq = 0;

  notify(text: string, kind: "info" | "error" = "info") {
    this.toast = { text, kind };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = null), kind === "error" ? 6000 : 2500);
  }

  async init() {
    try {
      this.settings = await api.getSettings();
    } catch (e) {
      console.error(e);
      this.settings = null;
    }
    if (!this.settings) {
      this.screen = "connect";
      return;
    }
    this.screen = "main";
    // Everything below is stale-while-revalidate: cached data shows instantly.
    void this.loadSidebar();
    void this.runSearch(this.jql, this.viewId, this.viewName);
    api.getMyself().then(
      (me) => (this.me = me),
      (e) => this.notify(`Jira unreachable: ${errorMessage(e)}`, "error"),
    );
    void api.onIssueCached((key) => {
      if (key === this.selectedKey && !this.issue) void this.openIssue(key, { push: false });
    });
  }

  async connect(input: SettingsInput): Promise<void> {
    this.me = await api.connect(input);
    this.settings = await api.getSettings();
    this.screen = "main";
    void this.loadSidebar();
    void this.runSearch(QUICK_VIEWS[0].jql, QUICK_VIEWS[0].id, QUICK_VIEWS[0].name);
  }

  async disconnect() {
    await api.disconnect();
    this.settings = null;
    this.me = null;
    this.issues = [];
    this.issue = null;
    this.selectedKey = null;
    this.filters = [];
    this.projects = [];
    this.screen = "connect";
  }

  async loadSidebar() {
    await Promise.allSettled([
      swr(api.getFavouriteFilters, (v) => (this.filters = v)),
      swr(api.getProjects, (v) => (this.projects = v)),
    ]);
  }

  async runSearch(jql: string, viewId = "custom", viewName = "Search") {
    const seq = ++this.searchSeq;
    this.jql = jql;
    this.viewId = viewId;
    this.viewName = viewName;
    this.listError = null;
    this.listLoading = true;
    let gotAny = false;
    try {
      await swr<SearchResult>(
        (pc) => api.searchIssues(jql, 0, PAGE_SIZE, pc),
        (res, fromCache) => {
          if (seq !== this.searchSeq) return;
          gotAny = true;
          this.issues = res.issues;
          this.total = res.total;
          this.listFromCache = fromCache;
          if (!fromCache) void api.prefetchIssues(res.issues.slice(0, 15).map((i) => i.key));
        },
      );
    } catch (e) {
      if (seq !== this.searchSeq) return;
      this.listError = errorMessage(e);
      if (!gotAny) {
        this.issues = [];
        this.total = 0;
      }
    } finally {
      if (seq === this.searchSeq) this.listLoading = false;
    }
  }

  async loadMore() {
    if (this.listLoading || this.issues.length >= this.total) return;
    const seq = this.searchSeq;
    this.listLoading = true;
    try {
      const res = await api.searchIssues(this.jql, this.issues.length, PAGE_SIZE, false);
      if (seq !== this.searchSeq || !res) return;
      const seen = new Set(this.issues.map((i) => i.key));
      this.issues = [...this.issues, ...res.value.issues.filter((i) => !seen.has(i.key))];
      this.total = res.value.total;
      void api.prefetchIssues(res.value.issues.slice(0, 10).map((i) => i.key));
    } catch (e) {
      this.notify(errorMessage(e), "error");
    } finally {
      if (seq === this.searchSeq) this.listLoading = false;
    }
  }

  refreshList() {
    return this.runSearch(this.jql, this.viewId, this.viewName);
  }

  /** Quick search box: issue key → open it; JQL-looking → run it; else full text. */
  quickSearch(text: string) {
    const t = text.trim();
    if (!t) return;
    const km = t.match(ISSUE_KEY_RE);
    if (km) {
      void this.openIssue(km[1].toUpperCase());
      return;
    }
    if (JQL_HINT_RE.test(t)) {
      void this.runSearch(t, "custom", "JQL");
      return;
    }
    const escaped = t.replace(/(["\\])/g, "\\$1");
    void this.runSearch(`text ~ "${escaped}" ORDER BY updated DESC`, "custom", `Search: ${t}`);
  }

  async openIssue(key: string, opts: { push?: boolean } = {}) {
    const push = opts.push ?? true;
    if (push && this.selectedKey && this.selectedKey !== key) {
      this.history = [...this.history.slice(-49), this.selectedKey];
    }
    const seq = ++this.issueSeq;
    this.selectedKey = key;
    this.issueError = null;
    if (this.issue?.key !== key) this.issue = null;
    this.issueLoading = true;
    try {
      await swr<Issue>(
        (pc) => api.getIssue(key, pc),
        (issue, fromCache) => {
          if (seq !== this.issueSeq) return;
          this.issue = issue;
          this.issueFromCache = fromCache;
          this.issueError = null;
          if (fromCache) this.prefetchNeighbours(key);
        },
      );
    } catch (e) {
      if (seq !== this.issueSeq) return;
      this.issueError = errorMessage(e);
    } finally {
      if (seq === this.issueSeq) this.issueLoading = false;
    }
  }

  private prefetchNeighbours(key: string) {
    const idx = this.issues.findIndex((i) => i.key === key);
    if (idx < 0) return;
    const keys = this.issues.slice(Math.max(0, idx - 2), idx + 4).map((i) => i.key);
    void api.prefetchIssues(keys);
  }

  async refreshIssue() {
    if (!this.selectedKey) return;
    const key = this.selectedKey;
    const seq = ++this.issueSeq;
    this.issueLoading = true;
    try {
      const fresh = await api.getIssue(key, false);
      if (seq === this.issueSeq && fresh) {
        this.issue = fresh.value;
        this.issueFromCache = false;
      }
    } catch (e) {
      this.notify(errorMessage(e), "error");
    } finally {
      if (seq === this.issueSeq) this.issueLoading = false;
    }
  }

  /** Replace the current issue (after a write) and patch the list row. */
  applyIssue(issue: Issue | null) {
    if (!issue) return;
    if (this.selectedKey === issue.key) this.issue = issue;
    this.issues = this.issues.map((i) => (i.key === issue.key ? { ...i, fields: { ...i.fields, ...pickListFields(issue) } } : i));
  }

  back() {
    const prev = this.history.at(-1);
    if (!prev) return;
    this.history = this.history.slice(0, -1);
    void this.openIssue(prev, { push: false });
  }

  closeIssue() {
    this.selectedKey = null;
    this.issue = null;
    this.focus = false;
  }

  selectRelative(delta: number) {
    if (!this.issues.length) return;
    const idx = this.selectedIndex;
    const next = idx < 0 ? 0 : Math.min(this.issues.length - 1, Math.max(0, idx + delta));
    const key = this.issues[next]?.key;
    if (key && key !== this.selectedKey) void this.openIssue(key, { push: false });
    if (next >= this.issues.length - 5) void this.loadMore();
  }

  toggleFocus() {
    this.focus = !this.focus;
  }

  editIssue(key = this.selectedKey) {
    if (key) this.editor = { kind: "edit", key };
  }

  newIssue(projectKey: string | null = this.issue?.fields.project?.key ?? null) {
    this.editor = { kind: "create", projectKey };
  }

  closeEditor() {
    this.editor = null;
  }

  /** After `create_issue`: show the new issue and put it at the top of the list. */
  addCreatedIssue(issue: Issue) {
    if (!this.issues.some((i) => i.key === issue.key)) {
      this.issues = [issue, ...this.issues];
      this.total += 1;
    }
    void this.openIssue(issue.key);
  }
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

export const app = new AppStore();
