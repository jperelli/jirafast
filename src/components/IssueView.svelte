<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app } from "../lib/store.svelte";
  import { api, errorMessage } from "../lib/api";
  import { absoluteTime, formatBytes, relativeTime } from "../lib/format";
  import { toAssetUrl, toJiraUrl } from "../lib/html";
  import type { Comment, LinkedIssue, Transition } from "../lib/types";
  import Avatar from "./Avatar.svelte";
  import JiraHtml from "./JiraHtml.svelte";
  import CommentBox from "./CommentBox.svelte";

  const issue = $derived(app.issue);
  const f = $derived(issue?.fields);
  const rendered = $derived(issue?.renderedFields);

  let newestFirst = $state(false);
  let transitioning = $state(false);
  let scroller = $state<HTMLElement | null>(null);

  const comments = $derived.by((): Array<{ c: Comment; html: string }> => {
    const list = f?.comment?.comments ?? [];
    const renderedList = rendered?.comment?.comments ?? [];
    const byId = new Map<string, string>();
    renderedList.forEach((r, i) => byId.set(r.id ?? String(i), r.body));
    const out = list.map((c, i) => ({
      c,
      html: byId.get(c.id) ?? renderedList[i]?.body ?? c.renderedBody ?? escapePlain(c.body),
    }));
    return newestFirst ? out.reverse() : out;
  });

  const links = $derived.by(() => {
    const out: Array<{ label: string; issue: LinkedIssue }> = [];
    for (const l of f?.issuelinks ?? []) {
      if (l.outwardIssue) out.push({ label: l.type.outward, issue: l.outwardIssue });
      if (l.inwardIssue) out.push({ label: l.type.inward, issue: l.inwardIssue });
    }
    return out;
  });

  const transitions = $derived((issue?.transitions ?? []) as Transition[]);

  function escapePlain(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return `<p>${d.innerHTML.replace(/\n/g, "<br>")}</p>`;
  }

  function icon(url: string | undefined): string | null {
    return url ? toAssetUrl(url, app.baseUrl) ?? url : null;
  }

  async function openInBrowser() {
    if (!issue) return;
    try {
      await openUrl(toJiraUrl(`browse/${issue.key}`, app.baseUrl));
    } catch (e) {
      app.notify(errorMessage(e), "error");
    }
  }

  async function transition(e: Event) {
    const select = e.target as HTMLSelectElement;
    const id = select.value;
    select.value = "";
    if (!id || !issue) return;
    transitioning = true;
    try {
      const updated = await api.doTransition(issue.key, id);
      app.applyIssue(updated);
      app.notify("Status updated");
    } catch (err) {
      app.notify(errorMessage(err), "error");
    } finally {
      transitioning = false;
    }
  }

  async function assignToMe() {
    if (!issue || !app.me) return;
    try {
      app.applyIssue(await api.assignIssue(issue.key, app.me.name));
      app.notify(`Assigned to you`);
    } catch (err) {
      app.notify(errorMessage(err), "error");
    }
  }

  async function toggleFullscreen() {
    const w = getCurrentWindow();
    await w.setFullscreen(!(await w.isFullscreen()));
  }

  function scrollToComments() {
    scroller?.querySelector("#comments")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Reset scroll when switching issues.
  $effect(() => {
    void app.selectedKey;
    scroller?.scrollTo({ top: 0 });
  });
</script>

<section class="view" class:focus={app.focus}>
  {#if !app.selectedKey}
    <div class="empty muted">
      <div class="big">Select an issue</div>
      <div>Use <kbd>j</kbd>/<kbd>k</kbd> to move, <kbd>f</kbd> for focus mode, <kbd>/</kbd> to search, <kbd>?</kbd> for all shortcuts.</div>
    </div>
  {:else}
    <div class="toolbar">
      <button class="ghost" onclick={() => app.back()} disabled={!app.history.length} title="Back (u)">←</button>
      {#if app.focus}
        <button class="ghost" onclick={() => (app.focus = false)} title="Exit focus mode (Esc)">☰ List</button>
      {/if}
      <span class="crumb muted">
        {#if f?.project}<span>{f.project.name}</span><span class="sep">/</span>{/if}
        {#if f?.parent}
          <button class="link" onclick={() => f.parent && app.openIssue(f.parent.key)}>{f.parent.key}</button><span class="sep">/</span>
        {/if}
        <span class="mono key">{app.selectedKey}</span>
      </span>
      <span class="grow"></span>
      {#if app.issueLoading}<span class="spin" title="Refreshing…"></span>
      {:else if app.issueFromCache}<span class="muted tiny" title="Showing cached copy; refresh failed or pending">cached</span>{/if}
      <button class="ghost edit" onclick={() => app.editIssue()} title="Edit summary, description and fields (e)">✎ Edit</button>
      <button class="ghost" onclick={() => app.refreshIssue()} title="Refresh (r)">↻</button>
      <button class="ghost" onclick={scrollToComments} title="Jump to comments">💬 {f?.comment?.total ?? f?.comment?.comments?.length ?? 0}</button>
      <button class="ghost" class:on={app.focus} onclick={() => app.toggleFocus()} title="Focus mode: hide list & sidebar (f)">
        {app.focus ? "⤡ Focus" : "⤢ Focus"}
      </button>
      <button class="ghost" onclick={toggleFullscreen} title="Toggle fullscreen (F11)">⛶</button>
      <button class="ghost" onclick={openInBrowser} title="Open in browser">↗</button>
    </div>

    <div class="scroller" bind:this={scroller}>
      {#if app.issueError && !issue}
        <div class="content"><div class="error">{app.issueError}</div></div>
      {:else if !issue}
        <div class="content muted">Loading {app.selectedKey}…</div>
      {:else if f}
        <div class="content">
          <h1 class="summary">
            {#if icon(f.issuetype?.iconUrl)}<img class="typeicon" src={icon(f.issuetype?.iconUrl)} alt="" title={f.issuetype?.name} />{/if}
            {f.summary}
          </h1>

          <div class="meta">
            <div class="field">
              <span class="label">Status</span>
              <span class="value status">
                <span class="lozenge {f.status?.statusCategory?.key ?? ''}">{f.status?.name ?? "—"}</span>
                {#if transitions.length}
                  <select class="transition" onchange={transition} disabled={transitioning} value="">
                    <option value="" disabled>{transitioning ? "Updating…" : "Transition…"}</option>
                    {#each transitions as t (t.id)}
                      <option value={t.id}>{t.name}{t.to ? ` → ${t.to.name}` : ""}</option>
                    {/each}
                  </select>
                {/if}
              </span>
            </div>
            <div class="field">
              <span class="label">Assignee</span>
              <span class="value">
                {#if f.assignee}
                  <Avatar user={f.assignee} size={20} /> {f.assignee.displayName}
                {:else}
                  <span class="muted">Unassigned</span>
                {/if}
                {#if app.me && f.assignee?.name !== app.me.name}
                  <button class="link small" onclick={assignToMe}>assign to me</button>
                {/if}
              </span>
            </div>
            <div class="field">
              <span class="label">Reporter</span>
              <span class="value">
                {#if f.reporter}<Avatar user={f.reporter} size={20} /> {f.reporter.displayName}{:else}—{/if}
              </span>
            </div>
            <div class="field">
              <span class="label">Priority</span>
              <span class="value">
                {#if f.priority}
                  {#if icon(f.priority.iconUrl)}<img class="icon16" src={icon(f.priority.iconUrl)} alt="" />{/if}
                  {f.priority.name}
                {:else}—{/if}
              </span>
            </div>
            <div class="field">
              <span class="label">Type</span>
              <span class="value">{f.issuetype?.name ?? "—"}</span>
            </div>
            {#if f.resolution}
              <div class="field"><span class="label">Resolution</span><span class="value">{f.resolution.name}</span></div>
            {/if}
            {#if f.labels?.length}
              <div class="field">
                <span class="label">Labels</span>
                <span class="value tags">{#each f.labels as l (l)}<span class="tag">{l}</span>{/each}</span>
              </div>
            {/if}
            {#if f.components?.length}
              <div class="field">
                <span class="label">Components</span>
                <span class="value tags">{#each f.components as c (c.name)}<span class="tag">{c.name}</span>{/each}</span>
              </div>
            {/if}
            {#if f.fixVersions?.length}
              <div class="field">
                <span class="label">Fix versions</span>
                <span class="value tags">{#each f.fixVersions as v (v.name)}<span class="tag">{v.name}</span>{/each}</span>
              </div>
            {/if}
            {#if f.duedate}
              <div class="field"><span class="label">Due</span><span class="value">{f.duedate}</span></div>
            {/if}
            <div class="field">
              <span class="label">Created</span>
              <span class="value" title={absoluteTime(f.created)}>{relativeTime(f.created)}</span>
            </div>
            <div class="field">
              <span class="label">Updated</span>
              <span class="value" title={absoluteTime(f.updated)}>{relativeTime(f.updated)}</span>
            </div>
          </div>

          <h2>Description</h2>
          {#if rendered?.description || f.description}
            <JiraHtml html={rendered?.description ?? escapePlain(f.description ?? "")} class="description" />
          {:else}
            <p class="muted">No description.</p>
          {/if}

          {#if rendered?.environment || f.environment}
            <h2>Environment</h2>
            <JiraHtml html={rendered?.environment ?? escapePlain(f.environment ?? "")} />
          {/if}

          {#if f.attachment?.length}
            <h2>Attachments <span class="muted count">{f.attachment.length}</span></h2>
            <div class="attachments">
              {#each f.attachment as a (a.id)}
                <button class="attachment" title={`${a.filename} · ${formatBytes(a.size)} · ${a.author?.displayName ?? ""}`}
                  onclick={() => openUrl(a.content).catch((e) => app.notify(errorMessage(e), "error"))}>
                  {#if a.thumbnail && icon(a.thumbnail)}
                    <img src={icon(a.thumbnail)} alt={a.filename} loading="lazy" />
                  {:else}
                    <span class="file">{a.mimeType.split("/")[1]?.slice(0, 5) ?? "file"}</span>
                  {/if}
                  <span class="fname">{a.filename}</span>
                </button>
              {/each}
            </div>
          {/if}

          {#if f.subtasks?.length || links.length}
            <h2>Linked issues</h2>
            <ul class="links">
              {#each f.subtasks ?? [] as s (s.id)}
                <li>
                  <span class="muted rel">subtask</span>
                  <button class="link mono" onclick={() => app.openIssue(s.key)}>{s.key}</button>
                  <span class="lsum" class:done={s.fields.status?.statusCategory?.key === "done"}>{s.fields.summary}</span>
                  <span class="lozenge {s.fields.status?.statusCategory?.key ?? ''}">{s.fields.status?.name ?? ""}</span>
                </li>
              {/each}
              {#each links as l (l.issue.id + l.label)}
                <li>
                  <span class="muted rel">{l.label}</span>
                  <button class="link mono" onclick={() => app.openIssue(l.issue.key)}>{l.issue.key}</button>
                  <span class="lsum" class:done={l.issue.fields.status?.statusCategory?.key === "done"}>{l.issue.fields.summary}</span>
                  <span class="lozenge {l.issue.fields.status?.statusCategory?.key ?? ''}">{l.issue.fields.status?.name ?? ""}</span>
                </li>
              {/each}
            </ul>
          {/if}

          <h2 id="comments">
            Comments <span class="muted count">{comments.length}</span>
            <span class="grow"></span>
            <button class="ghost small" onclick={() => (newestFirst = !newestFirst)}>
              {newestFirst ? "Newest first" : "Oldest first"} ⇅
            </button>
          </h2>
          {#if !comments.length}
            <p class="muted">No comments yet.</p>
          {/if}
          <div class="comments">
            {#each comments as { c, html } (c.id)}
              <article class="comment">
                <header>
                  {#if c.author}<Avatar user={c.author} size={28} />{/if}
                  <span class="author">{c.author?.displayName ?? "Anonymous"}</span>
                  <span class="muted when" title={absoluteTime(c.created)}>{relativeTime(c.created)}</span>
                  {#if c.updated && c.updated !== c.created}
                    <span class="muted when" title={absoluteTime(c.updated)}>(edited)</span>
                  {/if}
                  {#if c.visibility}
                    <span class="lozenge" title="Restricted comment">🔒 {c.visibility.value}</span>
                  {/if}
                </header>
                <JiraHtml {html} class="body" />
              </article>
            {/each}
          </div>

          <CommentBox key={issue.key} />
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .view {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100vh;
    background: var(--bg);
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    text-align: center;
    gap: 8px;
    padding: 20px;
  }
  .big {
    font-size: 20px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    flex: none;
  }
  .toolbar button.ghost {
    padding: 4px 8px;
    white-space: nowrap;
  }
  .toolbar button.on {
    background: var(--accent-bg);
    color: var(--accent);
  }
  .crumb {
    display: flex;
    gap: 6px;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    margin-left: 6px;
  }
  .crumb .key {
    color: var(--fg);
    font-weight: 600;
  }
  .sep {
    opacity: 0.6;
  }
  .grow {
    flex: 1;
  }
  .tiny {
    font-size: 11px;
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    scroll-padding-top: 12px;
  }
  .content {
    max-width: var(--content-width);
    margin: 0 auto;
    padding: 18px 28px 60px;
  }
  .view.focus .content {
    max-width: min(1200px, 92vw);
    padding-top: 24px;
  }
  .view.focus :global(.jira-html) {
    font-size: 16px;
    line-height: 1.7;
  }
  h1.summary {
    font-size: 24px;
    line-height: 1.3;
    margin: 0 0 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .view.focus h1.summary {
    font-size: 28px;
  }
  .typeicon {
    width: 20px;
    height: 20px;
    vertical-align: -3px;
    margin-right: 6px;
  }
  .icon16 {
    width: 16px;
    height: 16px;
    vertical-align: text-bottom;
  }
  .meta {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 8px 18px;
    padding: 12px 14px;
    background: var(--bg-2);
    border-radius: 6px;
    font-size: 13px;
    margin-bottom: 8px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .value {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 22px;
  }
  .status select {
    padding: 2px 4px;
    font-size: 12px;
    border-width: 1px;
    max-width: 200px;
  }
  .tags {
    gap: 4px;
  }
  .tag {
    background: var(--bg-3);
    border-radius: 3px;
    padding: 0 6px;
    font-size: 12px;
  }
  button.link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
  }
  button.link:hover {
    text-decoration: underline;
    filter: none;
  }
  .small {
    font-size: 12px;
    padding: 2px 6px;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    margin: 28px 0 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
    font-weight: 600;
  }
  h2 .count {
    font-weight: 400;
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 10px 12px;
    border-radius: var(--radius);
  }
  .attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .attachment {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 140px;
    padding: 6px;
    background: var(--bg-2);
    border: 1px solid var(--border);
  }
  .attachment img {
    width: 126px;
    height: 90px;
    object-fit: cover;
    border-radius: 3px;
  }
  .attachment .file {
    width: 126px;
    height: 90px;
    display: grid;
    place-items: center;
    background: var(--bg-3);
    border-radius: 3px;
    font-family: var(--mono);
    font-size: 12px;
    text-transform: uppercase;
    color: var(--muted);
  }
  .fname {
    font-size: 11px;
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .links {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .links li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .rel {
    font-size: 11px;
    min-width: 90px;
  }
  .lsum {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lsum.done {
    text-decoration: line-through;
    color: var(--muted);
  }
  .comments {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .comment header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 13px;
  }
  .author {
    font-weight: 600;
  }
  .when {
    font-size: 12px;
  }
  .comment :global(.body) {
    padding-left: 36px;
  }
  .view.focus .comment :global(.body) {
    padding-left: 0;
    margin-top: 8px;
  }
</style>
