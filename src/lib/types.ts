// Shapes of the Jira Server / Data Center REST API v2 responses we consume.

export interface AvatarUrls {
  "16x16"?: string;
  "24x24"?: string;
  "32x32"?: string;
  "48x48"?: string;
}

export interface JiraUser {
  name: string;
  key?: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
  avatarUrls?: AvatarUrls;
}

export interface Named {
  id?: string;
  name: string;
  iconUrl?: string;
  description?: string;
}

export interface StatusCategory {
  id: number;
  key: "new" | "indeterminate" | "done" | "undefined" | string;
  colorName: string;
  name: string;
}

export interface Status extends Named {
  statusCategory?: StatusCategory;
}

/** One entry of `editmeta.fields` / `createmeta...issuetypes[].fields`. */
export interface FieldMeta {
  required: boolean;
  name: string;
  schema?: { type: string; items?: string; system?: string; custom?: string };
  operations?: string[];
  allowedValues?: (Named & { value?: string; children?: Named[] })[];
  autoCompleteUrl?: string;
}

export type FieldMetaMap = Record<string, FieldMeta>;

export interface EditMeta {
  fields: FieldMetaMap;
}

export interface CreateMetaIssueType extends IssueType {
  fields?: FieldMetaMap;
}

export interface CreateMeta {
  projects: (Project & { issuetypes: CreateMetaIssueType[] })[];
}

/** Payload for `PUT/POST issue` — only the fields we edit. */
export interface IssueFieldsInput {
  project?: { key: string };
  issuetype?: { id: string };
  parent?: { key: string };
  summary?: string;
  description?: string | null;
  environment?: string | null;
  priority?: { id: string } | null;
  assignee?: { name: string | null } | null;
  labels?: string[];
  components?: { id: string }[];
  fixVersions?: { id: string }[];
  duedate?: string | null;
  /** Any other field from editmeta (custom fields, reporter, timetracking, ...). */
  [field: string]: unknown;
}

export interface IssueType extends Named {
  subtask?: boolean;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  avatarUrls?: AvatarUrls;
  projectTypeKey?: string;
}

export interface Comment {
  id: string;
  author?: JiraUser;
  updateAuthor?: JiraUser;
  body: string;
  renderedBody?: string;
  created: string;
  updated: string;
  visibility?: { type: string; value: string };
}

export interface Attachment {
  id: string;
  filename: string;
  author?: JiraUser;
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
}

export interface IssueLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: LinkedIssue;
  outwardIssue?: LinkedIssue;
}

export interface LinkedIssue {
  id: string;
  key: string;
  fields: { summary: string; status?: Status; issuetype?: IssueType; priority?: Named };
}

export interface IssueFields {
  summary: string;
  description?: string | null;
  status?: Status;
  issuetype?: IssueType;
  priority?: Named;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  creator?: JiraUser | null;
  project?: Project;
  labels?: string[];
  components?: Named[];
  fixVersions?: Named[];
  versions?: Named[];
  created?: string;
  updated?: string;
  duedate?: string | null;
  resolution?: Named | null;
  resolutiondate?: string | null;
  environment?: string | null;
  parent?: LinkedIssue;
  subtasks?: LinkedIssue[];
  issuelinks?: IssueLink[];
  attachment?: Attachment[];
  comment?: { comments: Comment[]; total: number; maxResults: number; startAt: number };
  watches?: { watchCount: number; isWatching: boolean };
  votes?: { votes: number; hasVoted: boolean };
  timetracking?: {
    originalEstimate?: string;
    remainingEstimate?: string;
    timeSpent?: string;
  };
  // Custom fields (customfield_XXXXX) and anything else.
  [key: string]: unknown;
}

export interface RenderedFields {
  description?: string | null;
  environment?: string | null;
  comment?: { comments: Array<{ id?: string; body: string }> };
  [key: string]: unknown;
}

export interface Transition {
  id: string;
  name: string;
  to?: Status;
  hasScreen?: boolean;
}

export interface Issue {
  id: string;
  key: string;
  self?: string;
  fields: IssueFields;
  renderedFields?: RenderedFields;
  transitions?: Transition[];
}

export interface SearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: Issue[];
}

export interface Filter {
  id: string;
  name: string;
  jql: string;
  description?: string;
  favourite?: boolean;
  owner?: JiraUser;
}

export interface ServerInfo {
  baseUrl: string;
  version: string;
  deploymentType?: string;
  serverTitle?: string;
}

// ---- Jira Software (Agile) API ---------------------------------------------

export interface Board {
  id: number;
  name: string;
  type: "kanban" | "scrum" | string;
  location?: { projectKey?: string; projectName?: string; displayName?: string };
}

/** What `get_board_projects` learns about a board's project(s). */
export interface BoardProjectInfo {
  projects: Project[];
  location: { type?: string; key?: string; id?: string | number; name?: string } | null;
  jql: string | null;
}

export interface BoardColumn {
  name: string;
  statuses: { id: string }[];
  min?: number;
  max?: number;
}

export interface BoardConfig {
  id: number;
  name: string;
  type: string;
  filter?: { id: string };
  subQuery?: { query: string };
  columnConfig?: { columns: BoardColumn[]; constraintType?: string };
}

// ---- backend envelope -----------------------------------------------------

export interface Cached<T> {
  value: T;
  fetched_at: number;
  from_cache: boolean;
}

export type AuthInput =
  | { kind: "pat"; token: string }
  | { kind: "basic"; username: string; password: string };

export interface SettingsInput {
  base_url: string;
  auth: AuthInput;
  accept_invalid_certs: boolean;
}

export interface PublicSettings {
  base_url: string;
  auth_kind: "pat" | "basic";
  username: string | null;
  accept_invalid_certs: boolean;
}
