import { api } from "./api";
import { optionLabel } from "./fields";
import type { PickerOption } from "../components/Picker";
import type { JiraUser, Named } from "./types";

/** Jira label: no whitespace; Jira itself lower-cases nothing, so keep case. */
export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, "");
}

export function userOption(u: JiraUser): PickerOption {
  return { id: u.name, label: u.displayName, hint: u.name };
}

export async function searchUsers(q: string): Promise<PickerOption[]> {
  return (await api.searchUsers(q)).map(userOption);
}

export async function searchGroups(q: string): Promise<PickerOption[]> {
  return (await api.searchGroups(q)).map((name) => ({ id: name, label: name }));
}

export function labelSearcher(issueId?: string): (q: string) => Promise<PickerOption[]> {
  return async (q) => (await api.suggestLabels(q, issueId)).map((l) => ({ id: l, label: l }));
}

export function issueSearcher(currentJql?: string): (q: string) => Promise<PickerOption[]> {
  return async (q) => (await api.pickIssues(q, currentJql)).map((i) => ({ id: i.key, label: i.key, hint: i.summary }));
}

/**
 * Display names for ids taken from an issue's raw field value (a user, a group,
 * an option or an array of them), so pre-selected chips read like Jira shows them.
 */
export function rawLabels(raw: unknown): (id: string) => string | undefined {
  const map = new Map<string, string>();
  const add = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as { id?: unknown; name?: unknown; key?: unknown; value?: unknown; displayName?: unknown; summary?: unknown };
    const label = typeof o.displayName === "string" ? o.displayName : typeof o.name === "string" ? o.name : typeof o.value === "string" ? o.value : undefined;
    if (!label) return;
    for (const k of [o.id, o.name, o.key]) if (k != null) map.set(String(k), label);
  };
  if (Array.isArray(raw)) raw.forEach(add);
  else add(raw);
  return (id) => map.get(id);
}

/** `allowedValues` entries as picker options, keyed the same way the payload expects. */
export function allowedOptions(values: (Named & { value?: string })[] | undefined): PickerOption[] {
  return (values ?? []).map((o) => ({ id: o.id ?? optionLabel(o), label: optionLabel(o) }));
}
