import type { FieldMeta, FieldMetaMap, Named } from "./types";

/**
 * Generic editing of any field Jira's `editmeta` / `createmeta` reports, driven
 * by the field schema. The editor has dedicated UI for the common fields; this
 * covers the rest (custom fields, reporter, issue type, security, ...).
 */

/** Fields the editor renders with dedicated controls (or that make no sense in a form). */
export const DEDICATED_FIELDS = new Set([
  "summary",
  "description",
  "environment",
  "priority",
  "assignee",
  "labels",
  "components",
  "fixVersions",
  "duedate",
  "project",
  "issuetype",
  "parent",
  "issuelinks",
  "attachment",
  "comment",
  "worklog",
]);

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "select"
  | "multiselect"
  | "strings"
  | "user"
  | "users"
  | "cascading"
  | "timetracking"
  | "unsupported";

export interface Cascading {
  parent: string;
  child: string;
}
export interface TimeTracking {
  originalEstimate: string;
  remainingEstimate: string;
}

export type FieldValue = string | string[] | Cascading | TimeTracking;

const CF = "com.atlassian.jira.plugin.system.customfieldtypes:";

export function kindOf(meta: FieldMeta): FieldKind {
  const s = meta.schema;
  if (!s) return "unsupported";
  const custom = s.custom ?? "";
  const hasOptions = (meta.allowedValues?.length ?? 0) > 0;
  switch (s.type) {
    case "string":
      if (custom === `${CF}textarea`) return "textarea";
      return hasOptions ? "select" : "text";
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "user":
      return "user";
    case "option":
      return hasOptions ? "select" : "text";
    case "option-with-child":
      return "cascading";
    case "timetracking":
      return "timetracking";
    case "priority":
    case "issuetype":
    case "resolution":
    case "securitylevel":
    case "version":
    case "component":
    case "project":
      return hasOptions ? "select" : "unsupported";
    case "group":
      return "text";
    case "array":
      switch (s.items) {
        case "string":
          return hasOptions ? "multiselect" : "strings";
        case "user":
          return "users";
        case "group":
          return "strings";
        case "option":
        case "version":
        case "component":
          return hasOptions ? "multiselect" : "unsupported";
        default:
          return "unsupported";
      }
    default:
      return "unsupported";
  }
}

/** Values are sent back as `{ id }` for these, `{ name }` for users/groups, plain otherwise. */
function refKey(meta: FieldMeta): "id" | "name" | "value" {
  const s = meta.schema;
  if (!s) return "value";
  const t = s.type === "array" ? s.items : s.type;
  if (t === "user" || t === "group") return "name";
  if (t === "string") return "value";
  return "id";
}

function optionId(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { id?: unknown; name?: unknown; value?: unknown; key?: unknown };
    if (o.id != null) return String(o.id);
    if (o.name != null) return String(o.name);
    if (o.value != null) return String(o.value);
    if (o.key != null) return String(o.key);
  }
  return "";
}

/** For select-like fields the option list may carry `value` instead of `name` (custom options). */
export function optionLabel(v: Named & { value?: string }): string {
  return v.name ?? v.value ?? v.id ?? "";
}

/** Match an issue value to one of `allowedValues` by id, then by name/value. */
function matchOption(raw: unknown, meta: FieldMeta): string {
  const opts = meta.allowedValues ?? [];
  const id = optionId(raw);
  const byId = opts.find((o) => o.id != null && String(o.id) === id);
  if (byId) return String(byId.id);
  const label = typeof raw === "object" && raw ? optionLabel(raw as Named) : id;
  const byName = opts.find((o) => optionLabel(o) === label);
  return byName ? String(byName.id ?? optionLabel(byName)) : "";
}

/** Local datetime-input value (`YYYY-MM-DDTHH:mm`) from a Jira timestamp. */
function toLocalInput(s: string): string {
  const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Jira timestamp (`2024-03-01T10:22:00.000+0000`) from a datetime-input value. */
function fromLocalInput(v: string): string {
  const d = new Date(v);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  return `${v}:00.000${sign}${p(Math.trunc(off / 60))}${p(off % 60)}`;
}

/** Initial form value for a field from the issue's raw field value. */
export function initialValue(kind: FieldKind, meta: FieldMeta, raw: unknown): FieldValue {
  switch (kind) {
    case "select":
      return matchOption(raw, meta);
    case "multiselect":
      return Array.isArray(raw) ? raw.map((v) => matchOption(v, meta)).filter(Boolean) : [];
    case "strings":
    case "users":
      return Array.isArray(raw) ? raw.map(optionId).filter(Boolean).join(" ") : "";
    case "user":
      return optionId(raw);
    case "cascading": {
      const o = (raw ?? {}) as { child?: unknown };
      return { parent: matchOption(raw, meta), child: optionId(o.child) };
    }
    case "timetracking": {
      const t = (raw ?? {}) as { originalEstimate?: string; remainingEstimate?: string };
      return { originalEstimate: t.originalEstimate ?? "", remainingEstimate: t.remainingEstimate ?? "" };
    }
    case "datetime":
      return typeof raw === "string" ? toLocalInput(raw) : "";
    case "number":
      return typeof raw === "number" ? String(raw) : "";
    default:
      return raw == null ? "" : typeof raw === "string" ? raw : optionId(raw);
  }
}

/** Child options of a cascading select's chosen parent. */
export function childOptions(meta: FieldMeta, parentId: string): Named[] {
  return (meta.allowedValues ?? []).find((o) => String(o.id) === parentId)?.children ?? [];
}

/** REST payload for a field value; `null` clears it. */
export function toPayload(kind: FieldKind, meta: FieldMeta, value: FieldValue): unknown {
  const key = refKey(meta);
  const ref = (id: string) => (key === "value" ? id : { [key]: id });
  switch (kind) {
    case "select":
      return typeof value === "string" && value ? ref(value) : null;
    case "multiselect":
      return Array.isArray(value) ? value.map(ref) : [];
    case "strings":
      return typeof value === "string" ? splitList(value) : [];
    case "user":
      return typeof value === "string" && value.trim() ? { name: value.trim() } : null;
    case "users":
      return typeof value === "string" ? splitList(value).map((n) => ({ name: n })) : [];
    case "cascading": {
      const c = value as Cascading;
      if (!c.parent) return null;
      return c.child ? { id: c.parent, child: { id: c.child } } : { id: c.parent };
    }
    case "timetracking": {
      const t = value as TimeTracking;
      const out: Record<string, string> = {};
      if (t.originalEstimate.trim()) out.originalEstimate = t.originalEstimate.trim();
      if (t.remainingEstimate.trim()) out.remainingEstimate = t.remainingEstimate.trim();
      return Object.keys(out).length ? out : null;
    }
    case "number": {
      const n = Number(value);
      return typeof value === "string" && value.trim() && Number.isFinite(n) ? n : null;
    }
    case "datetime":
      return typeof value === "string" && value ? fromLocalInput(value) : null;
    default:
      return typeof value === "string" && value !== "" ? value : null;
  }
}

export interface GenericField {
  id: string;
  meta: FieldMeta;
  kind: FieldKind;
}

/** All editable fields not covered by the dedicated controls, in Jira's screen order. */
export function genericFields(meta: FieldMetaMap): GenericField[] {
  return Object.entries(meta)
    .filter(([id]) => !DEDICATED_FIELDS.has(id))
    .map(([id, m]) => ({ id, meta: m, kind: kindOf(m) }));
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Split a free-text list (labels, usernames, groups). */
export function splitList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
