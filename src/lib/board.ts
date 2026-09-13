import type { Board, BoardConfig, Issue, Project } from "./types";

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

export interface BoardFolder {
  key: string;
  name: string;
  boards: Board[];
}

const OTHER_FOLDER = "__other";

/** Boards grouped by the project they live in (sidebar folders), projects in Jira's order. */
export function groupBoards(boards: Board[], projects: Project[]): BoardFolder[] {
  const byKey = new Map<string, BoardFolder>();
  for (const b of boards) {
    const pk = b.location?.projectKey ?? OTHER_FOLDER;
    let folder = byKey.get(pk);
    if (!folder) {
      const project = projects.find((p) => p.key === pk);
      const name = project?.name ?? b.location?.projectName ?? (pk === OTHER_FOLDER ? "Other boards" : pk);
      folder = { key: pk, name, boards: [] };
      byKey.set(pk, folder);
    }
    folder.boards.push(b);
  }
  const order = new Map(projects.map((p, i) => [p.key, i]));
  const rank = (f: BoardFolder) => (f.key === OTHER_FOLDER ? Number.MAX_SAFE_INTEGER : (order.get(f.key) ?? order.size));
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
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
