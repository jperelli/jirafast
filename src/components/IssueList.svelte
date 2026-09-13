<script lang="ts">
  import { app } from "../lib/store.svelte";
  import { relativeTime } from "../lib/format";
  import { toAssetUrl } from "../lib/html";
  import Avatar from "./Avatar.svelte";

  let { searchBox = $bindable(null) }: { searchBox?: HTMLInputElement | null } = $props();

  let query = $state("");
  let listEl = $state<HTMLElement | null>(null);

  function submit(e: Event) {
    e.preventDefault();
    app.quickSearch(query);
    searchBox?.blur();
  }

  function onScroll() {
    if (!listEl) return;
    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 300) void app.loadMore();
  }

  // Keep the selected row visible when navigating with the keyboard.
  $effect(() => {
    const key = app.selectedKey;
    if (!key || !listEl) return;
    const row = listEl.querySelector<HTMLElement>(`[data-key="${key}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });

  function icon(url: string | undefined): string | null {
    return url ? toAssetUrl(url, app.baseUrl) ?? url : null;
  }
</script>

<section class="list-pane">
  <header>
    <form class="search" onsubmit={submit}>
      <input
        bind:this={searchBox}
        bind:value={query}
        type="search"
        placeholder="Search text, issue key or JQL…  ( / )"
        spellcheck="false"
      />
    </form>
    <div class="title">
      <span class="name" title={app.jql}>{app.viewName}</span>
      <span class="count muted">
        {#if app.listLoading}<span class="spin"></span>{/if}
        {app.total ? `${app.issues.length} / ${app.total}` : app.listLoading ? "" : "0"}
      </span>
      <button class="ghost icon" title="Refresh (r)" onclick={() => app.refreshList()}>↻</button>
      <button class="ghost icon" title="New issue (n)" onclick={() => app.newIssue()}>＋</button>
    </div>
  </header>

  {#if app.listError}
    <div class="error">{app.listError}</div>
  {/if}

  <div class="rows" bind:this={listEl} onscroll={onScroll}>
    {#each app.issues as issue (issue.key)}
      {@const f = issue.fields}
      {@const cat = f.status?.statusCategory?.key ?? ""}
      <button
        class="row"
        class:active={issue.key === app.selectedKey}
        class:done={cat === "done" || !!f.resolution}
        data-key={issue.key}
        onclick={() => app.openIssue(issue.key)}
      >
        <div class="line1">
          {#if icon(f.issuetype?.iconUrl)}
            <img class="type" src={icon(f.issuetype?.iconUrl)} alt={f.issuetype?.name ?? ""} title={f.issuetype?.name} />
          {/if}
          <span class="key mono">{issue.key}</span>
          {#if f.priority && icon(f.priority.iconUrl)}
            <img class="prio" src={icon(f.priority.iconUrl)} alt={f.priority.name} title={f.priority.name} />
          {/if}
          <span class="grow"></span>
          <span class="lozenge {cat}">{f.status?.name ?? ""}</span>
        </div>
        <div class="summary">{f.summary}</div>
        <div class="line3 muted">
          {#if f.assignee}
            <Avatar user={f.assignee} size={16} />
            <span class="assignee">{f.assignee.displayName}</span>
          {:else}
            <span class="assignee">Unassigned</span>
          {/if}
          <span class="grow"></span>
          <span title={f.updated}>{relativeTime(f.updated)}</span>
        </div>
      </button>
    {:else}
      {#if !app.listLoading && !app.listError}
        <div class="empty muted">No issues match.</div>
      {/if}
    {/each}
    {#if app.issues.length && app.issues.length < app.total}
      <button class="ghost more" onclick={() => app.loadMore()} disabled={app.listLoading}>
        {app.listLoading ? "Loading…" : "Load more"}
      </button>
    {/if}
  </div>
</section>

<style>
  .list-pane {
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
    min-width: 0;
    height: 100vh;
  }
  header {
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .search input {
    width: 100%;
    font-size: 13px;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .count {
    font-size: 12px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .icon {
    padding: 2px 6px;
    font-size: 15px;
    line-height: 1;
  }
  .error {
    margin: 8px;
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 10px;
    border-radius: var(--radius);
    font-size: 12px;
    word-break: break-word;
  }
  .rows {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .row {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row.active {
    background: var(--accent-bg);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row.done .summary {
    color: var(--muted);
  }
  .row.done .key {
    text-decoration: line-through;
  }
  .line1,
  .line3 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .line1 img,
  .line3 :global(img) {
    width: 16px;
    height: 16px;
    flex: none;
  }
  .key {
    color: var(--muted);
    font-size: 12px;
  }
  .grow {
    flex: 1;
  }
  .summary {
    margin: 3px 0 4px;
    font-size: 14px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .assignee {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 40px 12px;
    text-align: center;
  }
  .more {
    width: 100%;
    margin: 6px 0;
  }
</style>
