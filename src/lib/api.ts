import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Board,
  BoardConfig,
  Cached,
  Comment,
  CreateMeta,
  EditMeta,
  Filter,
  Issue,
  IssueFieldsInput,
  JiraUser,
  Project,
  PublicSettings,
  SearchResult,
  ServerInfo,
  SettingsInput,
  Transition,
} from "./types";

export const api = {
  getSettings: () => invoke<PublicSettings | null>("get_settings"),
  connect: (settings: SettingsInput) => invoke<JiraUser>("connect", { settings }),
  disconnect: () => invoke<void>("disconnect"),
  getMyself: () => invoke<JiraUser>("get_myself"),
  getServerInfo: () => invoke<ServerInfo>("get_server_info"),

  searchIssues: (jql: string, startAt: number, maxResults: number, preferCache: boolean) =>
    invoke<Cached<SearchResult> | null>("search_issues", { jql, startAt, maxResults, preferCache }),

  getIssue: (key: string, preferCache: boolean) =>
    invoke<Cached<Issue> | null>("get_issue", { key, preferCache }),

  prefetchIssues: (keys: string[], maxAgeSecs = 120) =>
    invoke<void>("prefetch_issues", { keys, maxAgeSecs }),

  addComment: (key: string, body: string) => invoke<Comment>("add_comment", { key, body }),
  updateIssue: (key: string, fields: IssueFieldsInput) => invoke<Issue | null>("update_issue", { key, fields }),
  createIssue: (fields: IssueFieldsInput) => invoke<Issue>("create_issue", { fields }),
  getEditMeta: (key: string) => invoke<EditMeta>("get_edit_meta", { key }),
  getCreateMeta: (projectKey: string, preferCache: boolean) =>
    invoke<Cached<CreateMeta> | null>("get_create_meta", { projectKey, preferCache }),
  renderWiki: (markup: string, issueKey?: string) =>
    invoke<string>("render_wiki", { markup, issueKey: issueKey ?? null }),
  getTransitions: (key: string) => invoke<{ transitions: Transition[] }>("get_transitions", { key }),
  doTransition: (key: string, transitionId: string, comment?: string) =>
    invoke<Issue | null>("do_transition", { key, transitionId, comment: comment ?? null }),
  assignIssue: (key: string, username: string | null) =>
    invoke<Issue | null>("assign_issue", { key, username }),

  getFavouriteFilters: (preferCache: boolean) =>
    invoke<Cached<Filter[]> | null>("get_favourite_filters", { preferCache }),
  getProjects: (preferCache: boolean) => invoke<Cached<Project[]> | null>("get_projects", { preferCache }),
  getBoards: (preferCache: boolean) => invoke<Cached<Board[]> | null>("get_boards", { preferCache }),
  getBoardConfiguration: (boardId: number, preferCache: boolean) =>
    invoke<Cached<BoardConfig> | null>("get_board_configuration", { boardId, preferCache }),
  getBoardIssues: (boardId: number, jql: string, preferCache: boolean) =>
    invoke<Cached<SearchResult> | null>("get_board_issues", { boardId, jql, preferCache }),
  searchUsers: (query: string) => invoke<JiraUser[]>("search_users", { query }),
  clearCache: () => invoke<void>("clear_cache"),

  onIssueCached: (cb: (key: string) => void): Promise<UnlistenFn> =>
    listen<string>("issue-cached", (e) => cb(e.payload)),
};

/**
 * Stale-while-revalidate helper: `onValue` fires immediately with the cached
 * value when there is one, then again with the fresh one. Returns the fresh
 * promise so callers can await completion / catch errors.
 */
export async function swr<T>(
  fetch: (preferCache: boolean) => Promise<Cached<T> | null>,
  onValue: (value: T, fromCache: boolean) => void,
): Promise<T | null> {
  let cachedSeen = false;
  try {
    const cached = await fetch(true);
    if (cached) {
      cachedSeen = true;
      onValue(cached.value, true);
    }
  } catch {
    // Cache misses are not errors; the fresh fetch below reports real ones.
  }
  try {
    const fresh = await fetch(false);
    if (fresh) onValue(fresh.value, false);
    return fresh?.value ?? null;
  } catch (e) {
    if (cachedSeen) {
      console.warn("refresh failed, showing cached copy", e);
      return null;
    }
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
