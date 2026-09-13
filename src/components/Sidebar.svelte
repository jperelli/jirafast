<script lang="ts">
  import { app, QUICK_VIEWS } from "../lib/store.svelte";
  import { errorMessage } from "../lib/api";

  let showAllProjects = $state(false);
  const visibleProjects = $derived(showAllProjects ? app.projects : app.projects.slice(0, 12));

  function pickView(id: string, name: string, jql: string) {
    void app.runSearch(jql, id, name);
  }

  async function disconnect() {
    if (!confirm("Disconnect and forget the stored credentials?")) return;
    try {
      await app.disconnect();
    } catch (e) {
      app.notify(errorMessage(e), "error");
    }
  }
</script>

<nav class="sidebar">
  <div class="brand">
    <span class="logo">jirafast</span>
    {#if app.me}
      <span class="me muted" title={app.me.emailAddress ?? app.me.name}>{app.me.displayName}</span>
    {/if}
  </div>

  <div class="section">
    <h3>Views</h3>
    {#each QUICK_VIEWS as v (v.id)}
      <button class="item" class:active={app.viewId === v.id} onclick={() => pickView(v.id, v.name, v.jql)}>
        {v.name}
      </button>
    {/each}
  </div>

  {#if app.filters.length}
    <div class="section">
      <h3>Favourite filters</h3>
      {#each app.filters as f (f.id)}
        <button
          class="item"
          class:active={app.viewId === `filter:${f.id}`}
          title={f.jql}
          onclick={() => pickView(`filter:${f.id}`, f.name, f.jql)}
        >
          {f.name}
        </button>
      {/each}
    </div>
  {/if}

  {#if app.projects.length}
    <div class="section">
      <h3>Projects</h3>
      {#each visibleProjects as p (p.id)}
        <button
          class="item"
          class:active={app.viewId === `project:${p.key}`}
          title={p.name}
          onclick={() => pickView(`project:${p.key}`, p.name, `project = "${p.key}" AND resolution = Unresolved ORDER BY updated DESC`)}
        >
          <span class="pkey mono">{p.key}</span>
          <span class="pname">{p.name}</span>
        </button>
      {/each}
      {#if app.projects.length > 12}
        <button class="item more muted" onclick={() => (showAllProjects = !showAllProjects)}>
          {showAllProjects ? "Show fewer" : `Show all ${app.projects.length}`}
        </button>
      {/if}
    </div>
  {/if}

  <div class="spacer"></div>
  <div class="footer">
    <span class="muted host" title={app.baseUrl}>{app.baseUrl.replace(/^https?:\/\//, "")}</span>
    <button class="ghost small" onclick={disconnect} title="Disconnect">Sign out</button>
  </div>
</nav>

<style>
  .sidebar {
    background: var(--bg-2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    padding: 10px 8px;
    gap: 12px;
    font-size: 13px;
  }
  .brand {
    display: flex;
    flex-direction: column;
    padding: 4px 8px 6px;
  }
  .logo {
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 15px;
  }
  .me {
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .section h3 {
    margin: 0 0 4px;
    padding: 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .item {
    display: flex;
    gap: 6px;
    align-items: baseline;
    width: 100%;
    text-align: left;
    background: none;
    padding: 5px 8px;
    border-radius: var(--radius);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item:hover {
    background: var(--bg-3);
  }
  .item.active {
    background: var(--accent-bg);
    color: var(--accent);
    font-weight: 600;
  }
  .pkey {
    font-size: 11px;
    color: var(--muted);
    min-width: 34px;
  }
  .item.active .pkey {
    color: var(--accent);
  }
  .pname {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .more {
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 4px;
    font-size: 12px;
  }
  .host {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .small {
    padding: 3px 6px;
    font-size: 12px;
  }
</style>
