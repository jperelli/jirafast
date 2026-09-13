import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Editor } from "@tiptap/react";
import { app, useApp, useBaseUrl, type EditorMode } from "../lib/store";
import { api, errorMessage, swr } from "../lib/api";
import type { CreateMeta, CreateMetaIssueType, FieldMetaMap, Issue, IssueFieldsInput, JiraUser, Named } from "../lib/types";
import { htmlToWiki, renderedToEditorHtml, roundTrips } from "../lib/wiki";
import { genericFields, initialValue, sameValue, toPayload, type FieldValue, type GenericField } from "../lib/fields";
import FieldControl from "./FieldControl";
import RichEditor from "./RichEditor";
import css from "./IssueEditor.module.css";

type DescMode = "rich" | "markup";

interface Form {
  summary: string;
  description: string;
  environment: string;
  priorityId: string;
  assignee: string;
  unassign: boolean;
  labels: string;
  componentIds: string[];
  fixVersionIds: string[];
  duedate: string;
  projectKey: string;
  issueTypeId: string;
  parentKey: string;
  /** Every other editmeta field, keyed by field id (see lib/fields). */
  extra: Record<string, FieldValue>;
}

const EMPTY_FORM: Form = {
  summary: "",
  description: "",
  environment: "",
  priorityId: "",
  assignee: "",
  unassign: false,
  labels: "",
  componentIds: [],
  fixVersionIds: [],
  duedate: "",
  projectKey: "",
  issueTypeId: "",
  parentKey: "",
  extra: {},
};

function fallbackMeta(): FieldMetaMap {
  const s = (name: string, type: string) => ({ required: false, name, schema: { type } });
  return {
    summary: { ...s("Summary", "string"), required: true },
    description: s("Description", "string"),
    labels: s("Labels", "array"),
    duedate: s("Due Date", "date"),
    assignee: s("Assignee", "user"),
  };
}

function ids(list: Named[] | undefined): string[] {
  return (list ?? []).flatMap((v) => (typeof v.id === "string" ? [v.id] : []));
}

function parseLabels(labels: string): string[] {
  return labels
    .split(/[\s,]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

async function toggleOsFullscreen() {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
}

export default function IssueEditor({ mode }: { mode: EditorMode }) {
  const isCreate = mode.kind === "create";
  const key = mode.kind === "edit" ? mode.key : null;
  const baseUrl = useBaseUrl();
  const projects = useApp((s) => s.projects);
  const me = useApp((s) => s.me);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const patch = useCallback((p: Partial<Form>) => setForm((f) => ({ ...f, ...p })), []);

  const [original, setOriginal] = useState<Issue | null>(null);
  const [meta, setMeta] = useState<FieldMetaMap | null>(null);
  const [createMeta, setCreateMeta] = useState<CreateMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [fieldsOpen, setFieldsOpen] = useState(isCreate);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [userHits, setUserHits] = useState<JiraUser[]>([]);
  const [fontSize, setFontSize] = useState(16);

  // Description editing: rich (TipTap) or raw wiki markup. `form.description`
  // is always the markup; rich edits are converted on every change.
  const [descMode, setDescMode] = useState<DescMode>("rich");
  const [richHtml, setRichHtml] = useState<string | null>(null);
  const [richKey, setRichKey] = useState(0);
  const [richBusy, setRichBusy] = useState(false);
  const [lossy, setLossy] = useState(false);
  const richSource = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const summaryInput = useRef<HTMLInputElement>(null);

  const issueTypes = useMemo<CreateMetaIssueType[]>(
    () => createMeta?.projects.find((p) => p.key === form.projectKey)?.issuetypes ?? [],
    [createMeta, form.projectKey],
  );
  const issueType = issueTypes.find((t) => t.id === form.issueTypeId) ?? null;
  const fields: FieldMetaMap = isCreate ? (issueType?.fields ?? {}) : (meta ?? {});
  const has = (name: string) => name in fields;
  const allowed = (name: string): Array<Named & { id: string }> =>
    (fields[name]?.allowedValues ?? []).filter((v): v is Named & { id: string } => typeof v.id === "string");
  const generic = useMemo(() => genericFields(fields), [fields]);
  const extraValue = (g: GenericField): FieldValue => form.extra[g.id] ?? initialValue(g.kind, g.meta, undefined);
  const setExtra = (id: string, v: FieldValue) => setForm((f) => ({ ...f, extra: { ...f.extra, [id]: v } }));

  const title = isCreate ? "New issue" : (key ?? "");

  // ---- load ----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        if (mode.kind === "edit") await loadEdit(mode.key);
        else await loadCreate(mode.projectKey);
      } catch (e) {
        if (!cancelled) setLoadError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadEdit(k: string) {
    const cur = app.state.issue;
    const [issueRes, editMeta] = await Promise.all([
      cur?.key === k ? Promise.resolve({ value: cur }) : api.getIssue(k, true).then((c) => c ?? api.getIssue(k, false)),
      api.getEditMeta(k).catch((e) => {
        app.notify(`Field metadata unavailable: ${errorMessage(e)}`, "error");
        return null;
      }),
    ]);
    const issue = issueRes?.value;
    if (!issue) throw new Error(`Issue ${k} not found`);
    setOriginal(issue);
    const metaFields = editMeta?.fields ?? fallbackMeta();
    setMeta(metaFields);
    const f = issue.fields;
    const extra: Record<string, FieldValue> = {};
    for (const g of genericFields(metaFields)) extra[g.id] = initialValue(g.kind, g.meta, f[g.id]);
    setForm({
      ...EMPTY_FORM,
      extra,
      summary: f.summary ?? "",
      description: f.description ?? "",
      environment: f.environment ?? "",
      priorityId: f.priority?.id ?? "",
      labels: (f.labels ?? []).join(" "),
      componentIds: ids(f.components),
      fixVersionIds: ids(f.fixVersions),
      duedate: f.duedate ?? "",
      projectKey: f.project?.key ?? "",
    });
    const rendered = issue.renderedFields?.description;
    await enterRich(f.description ?? "", typeof rendered === "string" ? rendered : null);
  }

  async function loadCreate(preferred: string | null) {
    if (!app.state.projects.length) await app.loadSidebar();
    const pk = preferred ?? app.state.projects[0]?.key ?? "";
    if (!pk) throw new Error("No projects available to create an issue in");
    patch({ projectKey: pk });
    setRichHtml("");
    await loadCreateMeta(pk);
  }

  async function loadCreateMeta(pk: string) {
    setCreateMeta(null);
    await swr<CreateMeta>(
      (pc) => api.getCreateMeta(pk, pc),
      (v) => {
        setCreateMeta(v);
        const types = v.projects.find((p) => p.key === pk)?.issuetypes ?? [];
        setForm((f) => {
          if (types.some((t) => t.id === f.issueTypeId)) return f;
          const pick = types.find((t) => !t.subtask && /task/i.test(t.name)) ?? types.find((t) => !t.subtask) ?? types[0];
          return { ...f, issueTypeId: pick?.id ?? "" };
        });
      },
    );
  }

  function onProjectChange(pk: string) {
    patch({ projectKey: pk, issueTypeId: "", extra: {} });
    void loadCreateMeta(pk).catch((e) => app.notify(errorMessage(e), "error"));
  }

  // ---- description modes ---------------------------------------------------
  /** Load `markup` into the rich editor (rendering through Jira unless `rendered` is given). */
  async function enterRich(markup: string, rendered: string | null = null) {
    setRichBusy(true);
    try {
      const html = markup.trim() ? (rendered ?? (await api.renderWiki(markup, key ?? undefined))) : "";
      richSource.current = markup;
      setRichHtml(renderedToEditorHtml(html, baseUrl));
      setRichKey((n) => n + 1);
      setDescMode("rich");
    } catch (e) {
      app.notify(`Rich editor unavailable: ${errorMessage(e)}`, "error");
      setDescMode("markup");
    } finally {
      setRichBusy(false);
    }
  }

  function onRichReady(editor: Editor) {
    const markup = richSource.current;
    setLossy(markup.trim() !== "" && !roundTrips(markup, editor.getHTML()));
  }

  function onRichChange(editor: Editor) {
    patch({ description: editor.isEmpty ? "" : htmlToWiki(editor.getHTML()) });
  }

  function toggleDescMode() {
    if (richBusy) return;
    if (descMode === "rich") {
      setDescMode("markup");
      setLossy(false);
      queueMicrotask(() => textarea.current?.focus());
    } else {
      void enterRich(form.description);
    }
  }

  // ---- payload -------------------------------------------------------------
  function buildUpdate(): IssueFieldsInput {
    const f = original?.fields;
    if (!f) return {};
    const out: IssueFieldsInput = {};
    if (form.summary !== (f.summary ?? "")) out.summary = form.summary;
    if (form.description !== (f.description ?? "")) out.description = form.description || null;
    if (has("environment") && form.environment !== (f.environment ?? "")) out.environment = form.environment || null;
    if (has("priority") && form.priorityId && form.priorityId !== (f.priority?.id ?? "")) out.priority = { id: form.priorityId };
    if (has("labels") && !sameSet(parseLabels(form.labels), f.labels ?? [])) out.labels = parseLabels(form.labels);
    if (has("components") && !sameSet(form.componentIds, ids(f.components))) out.components = form.componentIds.map((id) => ({ id }));
    if (has("fixVersions") && !sameSet(form.fixVersionIds, ids(f.fixVersions))) out.fixVersions = form.fixVersionIds.map((id) => ({ id }));
    if (has("duedate") && form.duedate !== (f.duedate ?? "")) out.duedate = form.duedate || null;
    if (has("assignee")) {
      const a = form.assignee.trim();
      if (form.unassign && f.assignee) out.assignee = { name: null };
      else if (!form.unassign && a && a !== (f.assignee?.name ?? "")) out.assignee = { name: a };
    }
    for (const g of generic) {
      if (g.kind === "unsupported") continue;
      const now = toPayload(g.kind, g.meta, extraValue(g));
      const was = toPayload(g.kind, g.meta, initialValue(g.kind, g.meta, f[g.id]));
      if (!sameValue(now, was)) out[g.id] = now;
    }
    return out;
  }

  function buildCreate(): IssueFieldsInput {
    const out: IssueFieldsInput = {
      project: { key: form.projectKey },
      issuetype: { id: form.issueTypeId },
      summary: form.summary.trim(),
    };
    if (form.description.trim()) out.description = form.description;
    if (has("environment") && form.environment.trim()) out.environment = form.environment;
    if (has("priority") && form.priorityId) out.priority = { id: form.priorityId };
    if (has("labels") && parseLabels(form.labels).length) out.labels = parseLabels(form.labels);
    if (has("components") && form.componentIds.length) out.components = form.componentIds.map((id) => ({ id }));
    if (has("fixVersions") && form.fixVersionIds.length) out.fixVersions = form.fixVersionIds.map((id) => ({ id }));
    if (has("duedate") && form.duedate) out.duedate = form.duedate;
    if (has("assignee") && form.assignee.trim()) out.assignee = { name: form.assignee.trim() };
    if (issueType?.subtask && form.parentKey.trim()) out.parent = { key: form.parentKey.trim().toUpperCase() };
    for (const g of generic) {
      if (g.kind === "unsupported" || !(g.id in form.extra)) continue;
      const v = toPayload(g.kind, g.meta, form.extra[g.id]);
      if (v != null && !(Array.isArray(v) && !v.length)) out[g.id] = v;
    }
    return out;
  }

  const dirty = isCreate ? form.summary.trim() !== "" || form.description.trim() !== "" : Object.keys(buildUpdate()).length > 0;

  async function save() {
    if (saving || loading) return;
    setSaveError(null);
    if (!form.summary.trim()) {
      setSaveError("Summary is required.");
      summaryInput.current?.focus();
      return;
    }
    if (isCreate && (!form.projectKey || !form.issueTypeId)) {
      setSaveError("Project and issue type are required.");
      setFieldsOpen(true);
      return;
    }
    setSaving(true);
    try {
      if (mode.kind === "edit") {
        const changes = buildUpdate();
        if (Object.keys(changes).length) {
          const updated = await api.updateIssue(mode.key, changes);
          app.applyIssue(updated);
          app.notify(`${mode.key} saved`);
        }
      } else {
        const created = await api.createIssue(buildCreate());
        app.notify(`${created.key} created`);
        app.addCreatedIssue(created);
      }
      app.closeEditor();
    } catch (e) {
      setSaveError(errorMessage(e));
      setFieldsOpen(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    app.closeEditor();
  }

  // ---- users ---------------------------------------------------------------
  const userTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function onAssigneeInput(value: string) {
    patch({ assignee: value, unassign: false });
    clearTimeout(userTimer.current);
    const q = value.trim();
    if (q.length < 2) {
      setUserHits([]);
      return;
    }
    userTimer.current = setTimeout(async () => {
      try {
        setUserHits(await api.searchUsers(q));
      } catch {
        setUserHits([]);
      }
    }, 250);
  }

  // ---- keyboard ------------------------------------------------------------
  const latest = useRef({ save, cancel, toggleDescMode, confirmDiscard, hasHits: userHits.length > 0, fieldsOpen, description: form.description });
  latest.current = { save, cancel, toggleDescMode, confirmDiscard, hasHits: userHits.length > 0, fieldsOpen, description: form.description };

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "F11") return;
      const l = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const inRich = e.target instanceof HTMLElement && e.target.closest(".ProseMirror") !== null;
      if (mod && (e.key === "s" || e.key === "Enter")) {
        e.preventDefault();
        void l.save();
      } else if (mod && ((e.key.toLowerCase() === "b" && !inRich) || (e.shiftKey && e.key.toLowerCase() === "f"))) {
        e.preventDefault();
        setFieldsOpen((v) => !v);
      } else if (mod && e.key === "p") {
        e.preventDefault();
        l.toggleDescMode();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (l.confirmDiscard) setConfirmDiscard(false);
        else if (l.hasHits) setUserHits([]);
        else if (l.fieldsOpen && !isCreate) setFieldsOpen(false);
        else l.cancel();
      }
    }
    window.addEventListener("keydown", onKeydown, true);
    return () => window.removeEventListener("keydown", onKeydown, true);
  }, [isCreate]);

  function insertTab(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: s, selectionEnd: en } = ta;
    patch({ description: form.description.slice(0, s) + "  " + form.description.slice(en) });
    queueMicrotask(() => ta.setSelectionRange(s + 2, s + 2));
  }

  function openImage(src: string, alt: string) {
    app.openLightbox([{ src, title: alt || "Image" }], 0);
  }

  // ---- render --------------------------------------------------------------
  return (
    <div className={`${css.editor} ${fieldsOpen ? css.fieldsOpen : ""}`}>
      <header className={css.bar}>
        <button className={`ghost ${fieldsOpen ? css.on : ""}`} onClick={() => setFieldsOpen((v) => !v)} title="Show / hide fields (Ctrl+Shift+F)">
          ☰ Fields
        </button>
        <span className={css.title}>
          <span className={`mono ${css.key}`}>{title}</span>
          {!isCreate && form.summary && (
            <>
              <span className="muted">·</span>
              <span className={`muted ${css.ellipsis}`}>{form.summary}</span>
            </>
          )}
          {dirty && <span className={css.dot} title="Unsaved changes"></span>}
        </span>
        <span className={css.grow}></span>
        <button className="ghost" onClick={() => setFontSize((f) => Math.max(12, f - 1))} title="Smaller text">
          A−
        </button>
        <button className="ghost" onClick={() => setFontSize((f) => Math.min(28, f + 1))} title="Larger text">
          A+
        </button>
        <div className={css.modes} role="group" title="Description editor mode (Ctrl+P)">
          <button className={`ghost ${descMode === "rich" ? css.on : ""}`} onClick={() => descMode !== "rich" && toggleDescMode()} disabled={richBusy}>
            {richBusy && <span className="spin"></span>} Rich text
          </button>
          <button className={`ghost ${descMode === "markup" ? css.on : ""}`} onClick={() => descMode !== "markup" && toggleDescMode()} disabled={richBusy}>
            Markup
          </button>
        </div>
        <button className="ghost" onClick={() => void toggleOsFullscreen()} title="Toggle fullscreen (F11)">
          ⛶
        </button>
        <button className="ghost" onClick={cancel} disabled={saving}>
          Cancel
        </button>
        <button className="primary" onClick={() => void save()} disabled={saving || loading || (!isCreate && !dirty)} title="Save (Ctrl+S)">
          {saving && <span className="spin"></span>}
          {isCreate ? "Create" : "Save"}
        </button>
      </header>

      {confirmDiscard && (
        <div className={`${css.banner} ${css.warn}`}>
          Discard unsaved changes?
          <button onClick={() => app.closeEditor()}>Discard</button>
          <button className="ghost" onClick={() => setConfirmDiscard(false)}>
            Keep editing
          </button>
        </div>
      )}
      {saveError && <div className={`${css.banner} ${css.error}`}>{saveError}</div>}
      {lossy && descMode === "rich" && (
        <div className={`${css.banner} ${css.warn}`}>
          <span>
            This description uses markup the rich editor can't represent exactly (e.g. colors, panels, macros). Editing here will simplify it —
            switch to Markup to keep it verbatim.
          </span>
          <button className="ghost" onClick={toggleDescMode}>
            Edit markup
          </button>
          <button className="ghost" onClick={() => setLossy(false)}>
            Got it
          </button>
        </div>
      )}

      <div className={css.body}>
        {fieldsOpen && (
          <aside className={css.fields}>
            {loading ? (
              <div className="muted">
                <span className="spin"></span> Loading fields…
              </div>
            ) : loadError ? (
              <div className={css.errorText}>{loadError}</div>
            ) : (
              <>
                {isCreate && (
                  <>
                    <label>
                      <span>Project</span>
                      <select value={form.projectKey} onChange={(e) => onProjectChange(e.target.value)}>
                        {projects.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.key} · {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Issue type</span>
                      <select value={form.issueTypeId} onChange={(e) => patch({ issueTypeId: e.target.value })} disabled={!issueTypes.length}>
                        {issueTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {issueType?.subtask && (
                      <label>
                        <span>Parent issue</span>
                        <input value={form.parentKey} onChange={(e) => patch({ parentKey: e.target.value })} placeholder={`${form.projectKey}-123`} spellCheck={false} />
                      </label>
                    )}
                  </>
                )}

                {has("priority") && (
                  <label>
                    <span>Priority</span>
                    <select value={form.priorityId} onChange={(e) => patch({ priorityId: e.target.value })}>
                      {isCreate && <option value="">Default</option>}
                      {allowed("priority").map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {has("assignee") && (
                  <label className={css.assignee}>
                    <span>Assignee</span>
                    {!isCreate && original?.fields.assignee && !form.unassign && !form.assignee && (
                      <div className={`muted ${css.current}`}>Currently {original.fields.assignee.displayName}</div>
                    )}
                    <input
                      value={form.assignee}
                      onChange={(e) => onAssigneeInput(e.target.value)}
                      placeholder={form.unassign ? "Unassigned" : "username"}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {userHits.length > 0 && (
                      <div className={css.hits}>
                        {userHits.map((u) => (
                          <button
                            key={u.name}
                            className={`ghost ${css.hit}`}
                            onClick={() => {
                              patch({ assignee: u.name });
                              setUserHits([]);
                            }}
                          >
                            {u.displayName} <span className="muted">({u.name})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className={css.row}>
                      {me && (
                        <button className={`ghost ${css.small}`} onClick={() => patch({ assignee: me.name, unassign: false })}>
                          Me
                        </button>
                      )}
                      {!isCreate && (
                        <button className={`ghost ${css.small} ${form.unassign ? css.on : ""}`} onClick={() => patch({ unassign: !form.unassign, assignee: "" })}>
                          Unassign
                        </button>
                      )}
                    </div>
                  </label>
                )}

                {has("labels") && (
                  <label>
                    <span>Labels</span>
                    <input value={form.labels} onChange={(e) => patch({ labels: e.target.value })} placeholder="space separated" spellCheck={false} />
                  </label>
                )}

                {has("components") && allowed("components").length > 0 && (
                  <fieldset>
                    <legend>Components</legend>
                    {allowed("components").map((c) => (
                      <label key={c.id} className={css.check}>
                        <input type="checkbox" checked={form.componentIds.includes(c.id)} onChange={() => patch({ componentIds: toggleIn(form.componentIds, c.id) })} />
                        {c.name}
                      </label>
                    ))}
                  </fieldset>
                )}

                {has("fixVersions") && allowed("fixVersions").length > 0 && (
                  <fieldset>
                    <legend>Fix versions</legend>
                    {allowed("fixVersions").map((v) => (
                      <label key={v.id} className={css.check}>
                        <input type="checkbox" checked={form.fixVersionIds.includes(v.id)} onChange={() => patch({ fixVersionIds: toggleIn(form.fixVersionIds, v.id) })} />
                        {v.name}
                      </label>
                    ))}
                  </fieldset>
                )}

                {has("duedate") && (
                  <label>
                    <span>Due date</span>
                    <input type="date" value={form.duedate} onChange={(e) => patch({ duedate: e.target.value })} />
                  </label>
                )}

                {has("environment") && (
                  <label>
                    <span>Environment</span>
                    <textarea value={form.environment} onChange={(e) => patch({ environment: e.target.value })} rows={3} placeholder="Wiki markup"></textarea>
                  </label>
                )}

                {generic.length > 0 && <div className={css.divider}></div>}
                {generic.map((g) => (
                  <FieldControl key={g.id} field={g} value={extraValue(g)} onChange={(v) => setExtra(g.id, v)} allowEmpty={isCreate} me={me} />
                ))}
              </>
            )}
          </aside>
        )}

        <main className={css.zen}>
          {loading ? (
            <div className={`${css.center} muted`}>
              <span className="spin"></span>
            </div>
          ) : loadError && !isCreate ? (
            <div className={`${css.center} ${css.errorText}`}>{loadError}</div>
          ) : (
            <>
              <input
                ref={summaryInput}
                className={css.summary}
                value={form.summary}
                onChange={(e) => patch({ summary: e.target.value })}
                placeholder="Summary"
                style={{ fontSize: `${fontSize + 8}px` }}
                spellCheck
                autoFocus={isCreate}
              />
              {descMode === "rich" && richHtml !== null ? (
                <RichEditor
                  key={richKey}
                  contentKey={richKey}
                  html={richHtml}
                  fontSize={fontSize}
                  disabled={saving}
                  autoFocus={!isCreate}
                  onReady={onRichReady}
                  onChange={onRichChange}
                  onImageClick={openImage}
                />
              ) : (
                <textarea
                  ref={textarea}
                  className={css.markup}
                  value={form.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  onKeyDown={insertTab}
                  style={{ fontSize: `${fontSize}px` }}
                  placeholder="Description in Jira wiki markup — h2. Heading, *bold*, _italic_, {code}…{code}, * bullets, [~user]"
                  spellCheck
                  disabled={saving}
                  autoFocus={!isCreate}
                ></textarea>
              )}
              <footer className={`${css.hint} muted`}>
                {descMode === "rich" ? "Rich text (saved as wiki markup)" : "Wiki markup"} · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> fields ·{" "}
                <kbd>Ctrl</kbd>+<kbd>P</kbd> rich/markup · <kbd>Esc</kbd> cancel
                {descMode === "rich" && " · double-click an image to view it"}
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
