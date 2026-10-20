import { initialValue, kindOf, sameValue, toPayload, type FieldValue, type GenericField } from "./fields";
import type { FieldMetaMap, Issue, IssueFieldsInput, JiraErrorInfo, Transition } from "./types";

/**
 * Transitions that Jira refuses until some field is filled: a required field
 * on the transition screen, or a workflow validator ("Story Points is
 * required."). The dialog shows just those fields; screen fields travel in the
 * transition request, the rest are saved on the issue first.
 */

/** Not offered as a quick fix: whole-document fields or not really fields. */
const EXCLUDED = new Set(["summary", "description", "comment", "attachment", "issuelinks", "worklog", "project", "issuetype", "parent"]);

export interface FixField extends GenericField {
  /** On the transition screen: sent with the transition instead of `PUT issue`. */
  onScreen: boolean;
}

export interface FixPlan {
  fields: FixField[];
  /** Jira's message for each matched field, shown under it. */
  messages: Record<string, string>;
  /** Error messages no editable field could be matched to; shown as-is. */
  unresolved: string[];
}

/** Editable fields of a transition screen, in Jira's order. */
export function screenFields(t: Transition | undefined): FieldMetaMap {
  const out: FieldMetaMap = {};
  for (const [id, m] of Object.entries(t?.fields ?? {})) if (!EXCLUDED.has(id)) out[id] = m;
  return out;
}

/** The field `id` as the dialog edits it: from the transition screen when it is there, else from editmeta. */
export function resolveField(id: string, screen: FieldMetaMap, edit: FieldMetaMap): FixField | null {
  const onScreen = id in screen;
  const meta = onScreen ? screen[id] : edit[id];
  if (!meta || EXCLUDED.has(id)) return null;
  return { id, meta, kind: kindOf(meta), onScreen };
}

/** Field whose name appears in a free-text message ("Story Points is required."); longest name wins. */
function fieldNamedIn(message: string, screen: FieldMetaMap, edit: FieldMetaMap): FixField | null {
  const text = message.toLowerCase();
  const ids = [...new Set([...Object.keys(screen), ...Object.keys(edit)])]
    .filter((id) => !EXCLUDED.has(id))
    .map((id) => ({ id, name: (screen[id] ?? edit[id]).name.toLowerCase() }))
    .filter((f) => f.name.length > 1 && text.includes(f.name))
    .sort((a, b) => b.name.length - a.name.length);
  return ids.length ? resolveField(ids[0].id, screen, edit) : null;
}

/** Fields to fill for Jira's error response: by field id, then by field name in the messages. */
export function fieldsForError(error: JiraErrorInfo, screen: FieldMetaMap, edit: FieldMetaMap): FixPlan {
  const fields: FixField[] = [];
  const messages: Record<string, string> = {};
  const unresolved: string[] = [];
  const add = (f: FixField | null, msg: string): boolean => {
    if (!f) return false;
    if (!fields.some((x) => x.id === f.id)) fields.push(f);
    if (msg) messages[f.id] = messages[f.id] ? `${messages[f.id]} ${msg}` : msg;
    return true;
  };
  for (const [id, msg] of Object.entries(error.errors)) {
    if (!add(resolveField(id, screen, edit), msg) && !add(fieldNamedIn(msg, screen, edit), msg)) unresolved.push(msg || id);
  }
  for (const msg of error.errorMessages) {
    if (!add(fieldNamedIn(msg, screen, edit), msg)) unresolved.push(msg);
  }
  if (!fields.length && !unresolved.length) unresolved.push(error.message);
  return { fields, messages, unresolved };
}

/** What a transition screen asks for before anything failed: its required fields. */
export function requiredScreenFields(screen: FieldMetaMap): FixField[] {
  return Object.entries(screen)
    .filter(([, m]) => m.required)
    .map(([id, m]) => ({ id, meta: m, kind: kindOf(m), onScreen: true }));
}

export function currentValue(f: FixField, values: Record<string, FieldValue>, issue: Issue): FieldValue {
  return f.id in values ? values[f.id] : initialValue(f.kind, f.meta, issue.fields[f.id]);
}

function isEmpty(v: unknown): boolean {
  return v == null || (Array.isArray(v) && v.length === 0);
}

/**
 * Payloads for the fix: `edit` has the changed off-screen fields (`PUT issue`),
 * `screen` the on-screen values (changed, or already set) for the transition.
 */
export function buildFixPayload(fields: FixField[], values: Record<string, FieldValue>, issue: Issue): { edit: IssueFieldsInput; screen: IssueFieldsInput } {
  const edit: IssueFieldsInput = {};
  const screen: IssueFieldsInput = {};
  for (const f of fields) {
    if (f.kind === "unsupported") continue;
    const now = toPayload(f.kind, f.meta, currentValue(f, values, issue));
    const was = toPayload(f.kind, f.meta, initialValue(f.kind, f.meta, issue.fields[f.id]));
    const changed = !sameValue(now, was);
    if (f.onScreen) {
      if (changed || !isEmpty(now)) screen[f.id] = now;
    } else if (changed) {
      edit[f.id] = now;
    }
  }
  return { edit, screen };
}
