import type { Board, BoardConfig, BoardProjectInfo, Issue, Project } from "./types";

/** How far back the last ("done") column of a kanban board reaches. */
export type DoneWindow = "30d" | "1y" | "all";

export const DONE_WINDOWS: { id: DoneWindow; label: string; days: number | null }[] = [
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "1y", label: "Last year", days: 365 },
  { id: "all", label: "All", days: null },
];

const DONE_WINDOW_KEY = "jirafast:doneWindow";

export function loadDoneWindow(): DoneWindow {
  const v = typeof localStorage === "undefined" ? null : localStorage.getItem(DONE_WINDOW_KEY);
  return DONE_WINDOWS.some((w) => w.id === v) ? (v as DoneWindow) : "30d";
}

export function saveDoneWindow(w: DoneWindow) {
  try {
    localStorage.setItem(DONE_WINDOW_KEY, w);
  } catch {
    // Private mode / quota: the choice simply won't persist.
  }
}

export interface ColumnDef {
  name: string;
  /** Status ids mapped to this column; empty when falling back to categories. */
  statusIds: string[];
  /** Status category key used when the board has no column configuration. */
  category?: "new" | "indeterminate" | "done";
  min?: number;
  max?: number;
}

const FALLBACK_COLUMNS: ColumnDef[] = [
  { name: "To Do", statusIds: [], category: "new" },
  { name: "In Progress", statusIds: [], category: "indeterminate" },
  { name: "Done", statusIds: [], category: "done" },
];

/** Columns from the board configuration, or a status-category fallback. */
export function columnsOf(config: BoardConfig | null): ColumnDef[] {
  const cols = config?.columnConfig?.columns ?? [];
  if (!cols.length) return FALLBACK_COLUMNS;
  return cols.map((c) => ({
    name: c.name,
    statusIds: (c.statuses ?? []).map((s) => String(s.id)),
    min: c.min,
    max: c.max,
  }));
}

function columnIndexOf(issue: Issue, columns: ColumnDef[]): number {
  const st = issue.fields.status;
  const id = st?.id != null ? String(st.id) : null;
  const cat = st?.statusCategory?.key;
  return columns.findIndex((c) => (c.category ? cat === c.category : id != null && c.statusIds.includes(id)));
}

/**
 * Buckets issues into columns (preserving order). Issues whose status is not
 * mapped to any column are dropped, like Jira does on the board itself.
 */
export function groupByColumn(issues: Issue[], columns: ColumnDef[]): Issue[][] {
  const out: Issue[][] = columns.map(() => []);
  for (const issue of issues) {
    const idx = columnIndexOf(issue, columns);
    if (idx >= 0) out[idx].push(issue);
  }
  return out;
}

/**
 * Extra JQL restricting the last column to issues completed within the window.
 * Everything in other columns passes through untouched.
 */
export function doneWindowJql(columns: ColumnDef[], window: DoneWindow): string {
  const days = DONE_WINDOWS.find((w) => w.id === window)?.days;
  const done = columns.at(-1);
  if (!days || !done) return "";
  const notDone = done.category
    ? `statusCategory != Done`
    : done.statusIds.length
      ? `status not in (${done.statusIds.join(", ")})`
      : "";
  if (!notDone) return "";
  return `${notDone} OR resolutiondate >= -${days}d OR (resolution is EMPTY AND updated >= -${days}d)`;
}

export interface ProjectFolder {
  key: string;
  name: string;
  /** The Jira project, or null for the "other boards" bucket. */
  project: Project | null;
  boards: Board[];
}

export const OTHER_FOLDER = "__other";

/**
 * Project references (keys, ids or names) in a JQL `project` clause:
 * `project = ABC`, `project in (ABC, "Some name", 10042)`, `project = "Some name"`.
 * Negated clauses (`!=`, `not in`) are ignored.
 */
export function jqlProjectRefs(jql: string): string[] {
  const refs: string[] = [];
  const re = /\bproject\s*(?:=|in)\s*(\(([^)]*)\)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([\w-]+))/gi;
  for (const m of jql.matchAll(re)) {
    if (m[2] !== undefined) {
      for (const part of m[2].split(",")) {
        const t = part.trim().replace(/^(["'])(.*)\1$/, "$2");
        if (t) refs.push(t);
      }
    } else refs.push(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return refs.filter(Boolean);
}

function matchProjects(refs: Iterable<string>, projects: Project[]): string[] {
  const keys = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim().toLowerCase();
    if (!ref) continue;
    const p = projects.find((p) => p.key.toLowerCase() === ref || p.id === ref || p.name.toLowerCase() === ref);
    if (p) keys.add(p.key);
  }
  return [...keys];
}

/**
 * Project keys a board belongs to: its `location` (Cloud / newer DC), else what
 * `board/{id}/project` returned, else the configuration's location, else the
 * projects named by its filter's JQL.
 */
function projectKeysOf(board: Board, projects: Project[], info: BoardProjectInfo | undefined): string[] {
  if (board.location?.projectKey) return [board.location.projectKey];
  if (!info) return [];
  const fromApi = matchProjects(
    info.projects.flatMap((p) => [p.key, p.id]),
    projects,
  );
  if (fromApi.length) return fromApi;
  const loc = info.location;
  if (loc?.type === "project" || loc?.key) {
    const fromLoc = matchProjects([loc.key ?? "", String(loc.id ?? ""), loc.name ?? ""], projects);
    if (fromLoc.length) return fromLoc;
  }
  return info.jql ? matchProjects(jqlProjectRefs(info.jql), projects) : [];
}

/**
 * Sidebar tree: every project (in Jira's order) with the boards that belong to
 * it, followed by an "other" folder for boards that map to no known project.
 * A board spanning several projects is listed under each of them.
 */
export function groupBoards(boards: Board[], projects: Project[], boardProjects: Record<number, BoardProjectInfo>): ProjectFolder[] {
  const folders = new Map<string, ProjectFolder>(projects.map((p) => [p.key, { key: p.key, name: p.name, project: p, boards: [] }]));
  const other: ProjectFolder = { key: OTHER_FOLDER, name: "Other boards", project: null, boards: [] };
  for (const b of boards) {
    const keys = projectKeysOf(b, projects, boardProjects[b.id]).filter((k) => folders.has(k));
    if (!keys.length) other.boards.push(b);
    for (const k of keys) folders.get(k)?.boards.push(b);
  }
  const out = [...folders.values()];
  if (other.boards.length) out.push(other);
  return out;
}

const OPEN_FOLDERS_KEY = "jirafast:openBoardFolders";

export function loadOpenFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_FOLDERS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveOpenFolders(open: Set<string>) {
  try {
    localStorage.setItem(OPEN_FOLDERS_KEY, JSON.stringify([...open]));
  } catch {
    // Private mode / quota: the choice simply won't persist.
  }
}

/**
 * Board search: every whitespace-separated term must appear in the card's
 * key, summary, labels, assignee, type, priority or status (case-insensitive).
 */
export function matchesBoardQuery(issue: Issue, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const f = issue.fields;
  const hay = [
    issue.key,
    f.summary,
    ...(f.labels ?? []),
    f.assignee?.displayName,
    f.assignee?.name,
    f.issuetype?.name,
    f.priority?.name,
    f.status?.name,
    ...(f.components ?? []).map((c) => c.name),
  ]
    .filter((s): s is string => typeof s === "string")
    .join("\n")
    .toLowerCase();
  return terms.every((t) => hay.includes(t));
}
