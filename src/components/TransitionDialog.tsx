import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, jiraErrorInfo } from "../lib/api";
import type { FieldValue } from "../lib/fields";
import { buildFixPayload, currentValue, fieldsForError, requiredScreenFields, resolveField, screenFields, type FixField } from "../lib/transitions";
import type { FieldMetaMap, Issue, JiraErrorInfo, JiraUser, Transition } from "../lib/types";
import FieldControl from "./FieldControl";
import editorCss from "./IssueEditor.module.css";
import css from "./TransitionDialog.module.css";

interface Props {
  issue: Issue;
  transition: Transition;
  /** Jira's refusal when the transition was already attempted; `null` when the screen is shown up front. */
  error: JiraErrorInfo | null;
  me: JiraUser | null;
  onClose: () => void;
  /** The transition went through; `updated` is the refreshed issue (or null if the refresh failed). */
  onDone: (updated: Issue | null) => void;
  /** Off-screen fields were saved on the issue (even if the transition then failed). */
  onSaved: (updated: Issue | null) => void;
}

interface Meta {
  screen: FieldMetaMap;
  edit: FieldMetaMap;
}

/**
 * "Fill these fields and move": the popup for a transition Jira will not (or
 * did not) accept without more data. Shows only the fields involved, saves
 * them, then performs the transition in one go.
 */
export default function TransitionDialog({ issue, transition, error: initialError, me, onClose, onDone, onSaved }: Props) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<JiraErrorInfo | null>(initialError);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [ids, setIds] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const autoSubmitted = useRef(false);
  const target = transition.to?.name ?? transition.name;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [transitions, editMeta] = await Promise.all([
        api.getTransitions(issue.key).catch((e) => {
          console.warn("transition fields unavailable", e);
          return null;
        }),
        api.getEditMeta(issue.key).catch((e) => {
          console.warn("editmeta unavailable", e);
          return null;
        }),
      ]);
      if (cancelled) return;
      const t = transitions?.transitions.find((x) => x.id === transition.id) ?? transition;
      setMeta({ screen: screenFields(t), edit: editMeta?.fields ?? {} });
    })();
    return () => {
      cancelled = true;
    };
  }, [issue.key, transition.id]);

  const plan = useMemo(() => {
    if (!meta) return null;
    return error ? fieldsForError(error, meta.screen, meta.edit) : { fields: requiredScreenFields(meta.screen), messages: {}, unresolved: [] };
  }, [meta, error]);

  // Fields only ever accumulate: a second refusal must not hide what the user just filled.
  useEffect(() => {
    if (!plan || !meta) return;
    const wanted = [...plan.fields.map((f) => f.id), ...(showAll ? Object.keys(meta.screen) : [])];
    setIds((cur) => {
      const next = [...cur];
      for (const id of wanted) if (!next.includes(id)) next.push(id);
      return next.length === cur.length ? cur : next;
    });
  }, [plan, meta, showAll]);

  const fields = useMemo((): FixField[] => {
    if (!meta) return [];
    return ids.map((id) => resolveField(id, meta.screen, meta.edit)).filter((f): f is FixField => !!f);
  }, [meta, ids]);

  const hiddenScreenCount = meta ? Object.keys(meta.screen).filter((id) => !ids.includes(id)).length : 0;
  const fieldErrors = plan?.messages ?? {};

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  // A screen with nothing to fill: just move.
  useEffect(() => {
    if (!meta || error || autoSubmitted.current) return;
    if (Object.keys(meta.screen).length === 0) {
      autoSubmitted.current = true;
      void save();
    }
  }, [meta, error]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const { edit, screen } = buildFixPayload(fields, values, issue);
      if (Object.keys(edit).length) onSaved(await api.updateIssue(issue.key, edit));
      onDone(await api.doTransition(issue.key, transition.id, undefined, screen));
    } catch (e) {
      setError(jiraErrorInfo(e));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Keep j/k/e/… from acting on the issue behind the dialog.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  const loading = !meta;
  const unresolved = plan?.unresolved ?? [];
  const nothingToShow = !loading && fields.length === 0;

  return (
    <div className={css.backdrop} onMouseDown={onClose}>
      <div ref={dialog} className={css.dialog} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown} role="dialog" aria-label={`Move to ${target}`} tabIndex={-1}>
        <div className={css.header}>
          <h2>
            {transition.name}
            {transition.to && transition.to.name !== transition.name ? ` → ${transition.to.name}` : ""}
          </h2>
          <div className={`muted ${css.sub}`}>
            {issue.key} · {error ? "Jira needs more before it can move this issue" : "This transition asks for a few fields"}
          </div>
        </div>

        {unresolved.length > 0 && (
          <div className={css.errors}>
            <ul>
              {unresolved.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <div className={`muted ${css.hint}`}>Loading fields…</div>
        ) : (
          <div className={`${editorCss.fields} ${css.form}`}>
            {nothingToShow && <div className={`muted ${css.hint}`}>{error ? "No editable field matched Jira's message; fix it in the editor (e) and try again." : "Nothing is required here."}</div>}
            {fields.map((f) => (
              <div key={f.id}>
                <FieldControl field={f} value={currentValue(f, values, issue)} onChange={(v) => setValues((cur) => ({ ...cur, [f.id]: v }))} allowEmpty={false} me={me} issueId={issue.id} projectKey={issue.fields.project?.key} raw={issue.fields[f.id]} />
                {fieldErrors[f.id] && <div className={css.fieldError}>{fieldErrors[f.id]}</div>}
              </div>
            ))}
            {hiddenScreenCount > 0 && !showAll && (
              <button type="button" className={css.more} onClick={() => setShowAll(true)}>
                Show all {hiddenScreenCount + fields.filter((f) => f.onScreen).length} fields of this screen
              </button>
            )}
          </div>
        )}

        <div className={css.footer}>
          <span className={`muted ${css.grow}`}>Ctrl+Enter saves · Esc cancels</span>
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={saving || loading}>
            {saving ? "Saving…" : nothingToShow ? (error ? `Try “${target}” again` : `Move to ${target}`) : `Save and move to ${target}`}
          </button>
        </div>
      </div>
    </div>
  );
}
