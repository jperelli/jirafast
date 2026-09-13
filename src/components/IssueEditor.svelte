<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app, type EditorMode } from "../lib/store.svelte";
  import { api, errorMessage, swr } from "../lib/api";
  import type { CreateMeta, CreateMetaIssueType, FieldMetaMap, Issue, IssueFieldsInput, JiraUser, Named } from "../lib/types";
  import JiraHtml from "./JiraHtml.svelte";

  let { mode }: { mode: EditorMode } = $props();

  const isCreate = $derived(mode.kind === "create");
  const key = $derived(mode.kind === "edit" ? mode.key : null);

  // ---- form state ----------------------------------------------------------
  let summary = $state("");
  let description = $state("");
  let environment = $state("");
  let priorityId = $state("");
  let assignee = $state(""); // username; "" = leave as-is (edit) / default (create)
  let unassign = $state(false);
  let labels = $state("");
  let componentIds = $state<string[]>([]);
  let fixVersionIds = $state<string[]>([]);
  let duedate = $state("");
  let projectKey = $state("");
  let issueTypeId = $state("");
  let parentKey = $state("");

  let original = $state<Issue | null>(null);
  let meta = $state<FieldMetaMap | null>(null);
  let createMeta = $state<CreateMeta | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  // ---- ui state ------------------------------------------------------------
  let fieldsOpen = $state(false);
  let preview = $state(false);
  let previewHtml = $state<string | null>(null);
  let previewBusy = $state(false);
  let confirmDiscard = $state(false);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let userHits = $state<JiraUser[]>([]);
  let fontSize = $state(16);

  const issueTypes = $derived<CreateMetaIssueType[]>(
    createMeta?.projects.find((p) => p.key === projectKey)?.issuetypes ?? [],
  );
  const issueType = $derived(issueTypes.find((t) => t.id === issueTypeId) ?? null);
  const fields = $derived<FieldMetaMap>(isCreate ? issueType?.fields ?? {} : meta ?? {});

  function has(name: string): boolean {
    return name in fields;
  }
  function allowed(name: string): Array<Named & { id: string }> {
    return (fields[name]?.allowedValues ?? []).filter((v): v is Named & { id: string } => typeof v.id === "string");
  }
  function ids(list: Named[] | undefined): string[] {
    return (list ?? []).flatMap((v) => (typeof v.id === "string" ? [v.id] : []));
  }

  const title = $derived(isCreate ? "New issue" : key ?? "");

  const dirty = $derived.by(() => {
    if (isCreate) return summary.trim() !== "" || description.trim() !== "";
    return Object.keys(buildUpdate()).length > 0;
  });

  // ---- load ----------------------------------------------------------------
  onMount(() => {
    window.addEventListener("keydown", onKeydown, true);
    void load();
    return () => window.removeEventListener("keydown", onKeydown, true);
  });

  async function load() {
    loading = true;
    loadError = null;
    try {
      if (mode.kind === "edit") await loadEdit(mode.key);
      else await loadCreate(mode.projectKey);
    } catch (e) {
      loadError = errorMessage(e);
    } finally {
      loading = false;
      queueMicrotask(() => textarea?.focus());
    }
  }

  async function loadEdit(k: string) {
    const [issueRes, editMeta] = await Promise.all([
      app.issue?.key === k ? Promise.resolve({ value: app.issue }) : api.getIssue(k, true).then((c) => c ?? api.getIssue(k, false)),
      api.getEditMeta(k).catch((e) => {
        app.notify(`Field metadata unavailable: ${errorMessage(e)}`, "error");
        return null;
      }),
    ]);
    const issue = issueRes?.value;
    if (!issue) throw new Error(`Issue ${k} not found`);
    original = issue;
    meta = editMeta?.fields ?? fallbackMeta();
    const f = issue.fields;
    summary = f.summary ?? "";
    description = f.description ?? "";
    environment = f.environment ?? "";
    priorityId = f.priority?.id ?? "";
    labels = (f.labels ?? []).join(" ");
    componentIds = ids(f.components);
    fixVersionIds = ids(f.fixVersions);
    duedate = f.duedate ?? "";
    projectKey = f.project?.key ?? "";
  }

  async function loadCreate(preferred: string | null) {
    fieldsOpen = true;
    if (!app.projects.length) await app.loadSidebar();
    projectKey = preferred ?? app.projects[0]?.key ?? "";
    if (!projectKey) throw new Error("No projects available to create an issue in");
    await loadCreateMeta(projectKey);
  }

  async function loadCreateMeta(pk: string) {
    createMeta = null;
    await swr<CreateMeta>(
      (pc) => api.getCreateMeta(pk, pc),
      (v) => {
        createMeta = v;
        const types = v.projects.find((p) => p.key === pk)?.issuetypes ?? [];
        if (!types.some((t) => t.id === issueTypeId)) {
          issueTypeId = (types.find((t) => !t.subtask && /task/i.test(t.name)) ?? types.find((t) => !t.subtask) ?? types[0])?.id ?? "";
        }
      },
    );
  }

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

  function onProjectChange() {
    issueTypeId = "";
    void loadCreateMeta(projectKey).catch((e) => app.notify(errorMessage(e), "error"));
  }

  // ---- payload -------------------------------------------------------------
  function parsedLabels(): string[] {
    return labels
      .split(/[\s,]+/)
      .map((l) => l.trim())
      .filter(Boolean);
  }

  function sameSet(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((x) => b.includes(x));
  }

  function buildUpdate(): IssueFieldsInput {
    const f = original?.fields;
    if (!f) return {};
    const out: IssueFieldsInput = {};
    if (summary !== (f.summary ?? "")) out.summary = summary;
    if (description !== (f.description ?? "")) out.description = description || null;
    if (has("environment") && environment !== (f.environment ?? "")) out.environment = environment || null;
    if (has("priority") && priorityId && priorityId !== (f.priority?.id ?? "")) out.priority = { id: priorityId };
    if (has("labels") && !sameSet(parsedLabels(), f.labels ?? [])) out.labels = parsedLabels();
    if (has("components") && !sameSet(componentIds, ids(f.components))) {
      out.components = componentIds.map((id) => ({ id }));
    }
    if (has("fixVersions") && !sameSet(fixVersionIds, ids(f.fixVersions))) {
      out.fixVersions = fixVersionIds.map((id) => ({ id }));
    }
    if (has("duedate") && duedate !== (f.duedate ?? "")) out.duedate = duedate || null;
    if (has("assignee")) {
      if (unassign && f.assignee) out.assignee = { name: null };
      else if (!unassign && assignee.trim() && assignee.trim() !== (f.assignee?.name ?? "")) out.assignee = { name: assignee.trim() };
    }
    return out;
  }

  function buildCreate(): IssueFieldsInput {
    const out: IssueFieldsInput = {
      project: { key: projectKey },
      issuetype: { id: issueTypeId },
      summary: summary.trim(),
    };
    if (description.trim()) out.description = description;
    if (has("environment") && environment.trim()) out.environment = environment;
    if (has("priority") && priorityId) out.priority = { id: priorityId };
    if (has("labels") && parsedLabels().length) out.labels = parsedLabels();
    if (has("components") && componentIds.length) out.components = componentIds.map((id) => ({ id }));
    if (has("fixVersions") && fixVersionIds.length) out.fixVersions = fixVersionIds.map((id) => ({ id }));
    if (has("duedate") && duedate) out.duedate = duedate;
    if (has("assignee") && assignee.trim()) out.assignee = { name: assignee.trim() };
    if (issueType?.subtask && parentKey.trim()) out.parent = { key: parentKey.trim().toUpperCase() };
    return out;
  }

  async function save() {
    if (saving || loading) return;
    saveError = null;
    if (!summary.trim()) {
      saveError = "Summary is required.";
      fieldsOpen = true;
      return;
    }
    if (isCreate && (!projectKey || !issueTypeId)) {
      saveError = "Project and issue type are required.";
      fieldsOpen = true;
      return;
    }
    saving = true;
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
      saveError = errorMessage(e);
      fieldsOpen = true;
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (dirty && !confirmDiscard) {
      confirmDiscard = true;
      return;
    }
    app.closeEditor();
  }

  // ---- preview -------------------------------------------------------------
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!preview) return;
    const text = description;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      previewBusy = true;
      try {
        previewHtml = text.trim() ? await api.renderWiki(text, key ?? undefined) : "";
      } catch (e) {
        previewHtml = `<p class="muted">Preview unavailable: ${errorMessage(e)}</p>`;
      } finally {
        previewBusy = false;
      }
    }, 350);
  });

  // ---- users ---------------------------------------------------------------
  let userTimer: ReturnType<typeof setTimeout> | undefined;
  function onAssigneeInput() {
    unassign = false;
    clearTimeout(userTimer);
    const q = assignee.trim();
    if (q.length < 2) {
      userHits = [];
      return;
    }
    userTimer = setTimeout(async () => {
      try {
        userHits = await api.searchUsers(q);
      } catch {
        userHits = [];
      }
    }, 250);
  }

  // ---- keyboard ------------------------------------------------------------
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "F11") return; // App toggles OS fullscreen
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "s" || e.key === "Enter")) {
      e.preventDefault();
      void save();
    } else if (mod && e.key === "b") {
      e.preventDefault();
      fieldsOpen = !fieldsOpen;
    } else if (mod && e.key === "p") {
      e.preventDefault();
      preview = !preview;
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (confirmDiscard) confirmDiscard = false;
      else if (userHits.length) userHits = [];
      else if (fieldsOpen && !isCreate) fieldsOpen = false;
      else cancel();
    }
  }

  async function toggleOsFullscreen() {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  }

  function insertTab(e: KeyboardEvent) {
    if (e.key !== "Tab" || !textarea) return;
    e.preventDefault();
    const { selectionStart: s, selectionEnd: en } = textarea;
    description = description.slice(0, s) + "  " + description.slice(en);
    queueMicrotask(() => textarea?.setSelectionRange(s + 2, s + 2));
  }

  function toggleIn(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }
</script>

<div class="editor" class:fields-open={fieldsOpen} class:preview>
  <header class="bar">
    <button class="ghost" class:on={fieldsOpen} onclick={() => (fieldsOpen = !fieldsOpen)} title="Show / hide fields (Ctrl+B)">
      ☰ Fields
    </button>
    <span class="title">
      <span class="mono key">{title}</span>
      {#if !isCreate && summary}<span class="sep muted">·</span><span class="muted ellipsis">{summary}</span>{/if}
      {#if dirty}<span class="dot" title="Unsaved changes"></span>{/if}
    </span>
    <span class="grow"></span>
    <button class="ghost" onclick={() => (fontSize = Math.max(12, fontSize - 1))} title="Smaller text">A−</button>
    <button class="ghost" onclick={() => (fontSize = Math.min(28, fontSize + 1))} title="Larger text">A+</button>
    <button class="ghost" class:on={preview} onclick={() => (preview = !preview)} title="Live preview (Ctrl+P)">
      👁 Preview
    </button>
    <button class="ghost" onclick={toggleOsFullscreen} title="Toggle fullscreen (F11)">⛶</button>
    <button class="ghost" onclick={cancel} disabled={saving}>Cancel</button>
    <button class="primary" onclick={save} disabled={saving || loading || (!isCreate && !dirty)} title="Save (Ctrl+S)">
      {#if saving}<span class="spin"></span>{/if}
      {isCreate ? "Create" : "Save"}
    </button>
  </header>

  {#if confirmDiscard}
    <div class="banner warn">
      Discard unsaved changes?
      <button onclick={() => app.closeEditor()}>Discard</button>
      <button class="ghost" onclick={() => (confirmDiscard = false)}>Keep editing</button>
    </div>
  {/if}
  {#if saveError}
    <div class="banner error">{saveError}</div>
  {/if}

  <div class="body">
    {#if fieldsOpen}
      <aside class="fields">
        {#if loading}
          <div class="muted"><span class="spin"></span> Loading fields…</div>
        {:else if loadError}
          <div class="error">{loadError}</div>
        {:else}
          {#if isCreate}
            <label>
              <span>Project</span>
              <select bind:value={projectKey} onchange={onProjectChange}>
                {#each app.projects as p (p.key)}
                  <option value={p.key}>{p.key} · {p.name}</option>
                {/each}
              </select>
            </label>
            <label>
              <span>Issue type</span>
              <select bind:value={issueTypeId} disabled={!issueTypes.length}>
                {#each issueTypes as t (t.id)}
                  <option value={t.id}>{t.name}</option>
                {/each}
              </select>
            </label>
            {#if issueType?.subtask}
              <label>
                <span>Parent issue</span>
                <input bind:value={parentKey} placeholder="{projectKey}-123" spellcheck="false" />
              </label>
            {/if}
          {/if}

          <label>
            <span>Summary <b class="req">*</b></span>
            <input bind:value={summary} placeholder="What needs to be done?" />
          </label>

          {#if has("priority")}
            <label>
              <span>Priority</span>
              <select bind:value={priorityId}>
                {#if isCreate}<option value="">Default</option>{/if}
                {#each allowed("priority") as p (p.id)}
                  <option value={p.id}>{p.name}</option>
                {/each}
              </select>
            </label>
          {/if}

          {#if has("assignee")}
            <label class="assignee">
              <span>Assignee</span>
              {#if !isCreate && original?.fields.assignee && !unassign && !assignee}
                <div class="current muted">Currently {original.fields.assignee.displayName}</div>
              {/if}
              <input
                bind:value={assignee}
                oninput={onAssigneeInput}
                placeholder={unassign ? "Unassigned" : "username"}
                spellcheck="false"
                autocomplete="off"
              />
              {#if userHits.length}
                <div class="hits">
                  {#each userHits as u (u.name)}
                    <button class="ghost hit" onclick={() => { assignee = u.name; userHits = []; }}>
                      {u.displayName} <span class="muted">({u.name})</span>
                    </button>
                  {/each}
                </div>
              {/if}
              <div class="row">
                {#if app.me}<button class="ghost small" onclick={() => { assignee = app.me?.name ?? ""; unassign = false; }}>Me</button>{/if}
                {#if !isCreate}<button class="ghost small" class:on={unassign} onclick={() => { unassign = !unassign; assignee = ""; }}>Unassign</button>{/if}
              </div>
            </label>
          {/if}

          {#if has("labels")}
            <label>
              <span>Labels</span>
              <input bind:value={labels} placeholder="space separated" spellcheck="false" />
            </label>
          {/if}

          {#if has("components") && allowed("components").length}
            <fieldset>
              <legend>Components</legend>
              {#each allowed("components") as c (c.id)}
                <label class="check">
                  <input type="checkbox" checked={componentIds.includes(c.id)} onchange={() => (componentIds = toggleIn(componentIds, c.id))} />
                  {c.name}
                </label>
              {/each}
            </fieldset>
          {/if}

          {#if has("fixVersions") && allowed("fixVersions").length}
            <fieldset>
              <legend>Fix versions</legend>
              {#each allowed("fixVersions") as v (v.id)}
                <label class="check">
                  <input type="checkbox" checked={fixVersionIds.includes(v.id)} onchange={() => (fixVersionIds = toggleIn(fixVersionIds, v.id))} />
                  {v.name}
                </label>
              {/each}
            </fieldset>
          {/if}

          {#if has("duedate")}
            <label>
              <span>Due date</span>
              <input type="date" bind:value={duedate} />
            </label>
          {/if}

          {#if has("environment")}
            <label>
              <span>Environment</span>
              <textarea bind:value={environment} rows="3" placeholder="Wiki markup"></textarea>
            </label>
          {/if}
        {/if}
      </aside>
    {/if}

    <main class="zen">
      {#if loading}
        <div class="center muted"><span class="spin"></span></div>
      {:else if loadError && !isCreate}
        <div class="center error">{loadError}</div>
      {:else}
        <input
          class="summary"
          bind:value={summary}
          placeholder="Summary"
          style:font-size="{fontSize + 8}px"
          spellcheck="true"
        />
        <div class="panes">
          <textarea
            bind:this={textarea}
            bind:value={description}
            onkeydown={insertTab}
            style:font-size="{fontSize}px"
            placeholder="Description in Jira wiki markup — h2. Heading, *bold*, _italic_, {'{code}'}…{'{code}'}, * bullets, [~user]"
            spellcheck="true"
            disabled={saving}
          ></textarea>
          {#if preview}
            <div class="preview-pane" style:font-size="{fontSize}px">
              {#if previewBusy}<span class="spin float"></span>{/if}
              {#if previewHtml === null}
                <p class="muted">Rendering…</p>
              {:else if previewHtml === ""}
                <p class="muted">Nothing to preview.</p>
              {:else}
                <JiraHtml html={previewHtml} class="description" />
              {/if}
            </div>
          {/if}
        </div>
        <footer class="hint muted">
          Wiki markup · <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>B</kbd> fields · <kbd>Ctrl</kbd>+<kbd>P</kbd> preview · <kbd>Esc</kbd> cancel
        </footer>
      {/if}
    </main>
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    z-index: 20;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .bar .title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    margin-left: 6px;
  }
  .key {
    font-weight: 600;
  }
  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40vw;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--warn);
    flex-shrink: 0;
  }
  .grow {
    flex: 1;
  }
  button.on {
    background: var(--accent-bg);
    color: var(--accent);
  }
  .banner {
    padding: 8px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .banner.warn {
    background: var(--warn-bg);
  }
  .banner.error {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .fields {
    width: 300px;
    flex-shrink: 0;
    border-right: 1px solid var(--border);
    background: var(--bg-2);
    overflow-y: auto;
    padding: 12px 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .fields label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .fields label > span {
    color: var(--fg-2);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .req {
    color: var(--danger);
  }
  .fields input,
  .fields select,
  .fields textarea {
    width: 100%;
  }
  .fields fieldset {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px 8px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fields legend {
    color: var(--fg-2);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    padding: 0 4px;
  }
  .check {
    flex-direction: row !important;
    align-items: center;
    gap: 8px !important;
  }
  .check input {
    width: auto;
  }
  .assignee .row {
    display: flex;
    gap: 6px;
  }
  .small {
    padding: 2px 8px;
    font-size: 12px;
  }
  .current {
    font-size: 12px;
  }
  .hits {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg);
    max-height: 160px;
    overflow-y: auto;
  }
  .hit {
    text-align: left;
    border-radius: 0;
  }
  .error {
    color: var(--danger);
  }

  .zen {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 32px 8px;
  }
  .zen > * {
    width: 100%;
    max-width: var(--content-width);
  }
  .editor.preview .zen > .panes {
    max-width: none;
  }
  .summary {
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 4px 0 8px;
    font-weight: 600;
    line-height: 1.25;
    background: transparent;
  }
  .summary:focus {
    border-bottom-color: var(--accent);
  }
  .panes {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 24px;
    margin-top: 12px;
  }
  .panes > textarea {
    flex: 1;
    min-width: 0;
    height: 100%;
    resize: none;
    border: none;
    padding: 8px 0;
    background: transparent;
    font-family: var(--mono);
    line-height: 1.6;
    tab-size: 2;
  }
  .panes > textarea:focus {
    border: none;
  }
  .preview-pane {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 8px 16px;
    border-left: 1px solid var(--border);
    position: relative;
    line-height: 1.6;
  }
  .spin.float {
    position: absolute;
    top: 8px;
    right: 8px;
  }
  .hint {
    font-size: 12px;
    padding-top: 6px;
    flex-shrink: 0;
  }
  .center {
    flex: 1;
    display: grid;
    place-items: center;
  }
  kbd {
    font-family: var(--mono);
    font-size: 11px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 3px;
    padding: 0 4px;
    background: var(--bg-2);
  }
</style>
