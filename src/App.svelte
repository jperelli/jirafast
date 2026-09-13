<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app } from "./lib/store.svelte";
  import Connect from "./components/Connect.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import IssueList from "./components/IssueList.svelte";
  import IssueView from "./components/IssueView.svelte";
  import Toast from "./components/Toast.svelte";
  import ShortcutsHelp from "./components/ShortcutsHelp.svelte";

  let showHelp = $state(false);
  let searchBox = $state<HTMLInputElement | null>(null);

  onMount(() => {
    void app.init();
  });

  function isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
  }

  async function toggleFullscreen() {
    const w = getCurrentWindow();
    const fs = await w.isFullscreen();
    await w.setFullscreen(!fs);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "F11") {
      e.preventDefault();
      void toggleFullscreen();
      return;
    }
    if (app.screen !== "main") return;
    if (e.key === "Escape") {
      if (showHelp) showHelp = false;
      else if (isTyping(e)) (e.target as HTMLElement).blur();
      else if (app.focus) app.focus = false;
      return;
    }
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "j":
      case "ArrowDown":
        if (e.key === "ArrowDown" && app.focus) return;
        e.preventDefault();
        app.selectRelative(1);
        break;
      case "k":
      case "ArrowUp":
        if (e.key === "ArrowUp" && app.focus) return;
        e.preventDefault();
        app.selectRelative(-1);
        break;
      case "f":
        if (app.selectedKey) app.toggleFocus();
        break;
      case "/":
        e.preventDefault();
        app.focus = false;
        searchBox?.focus();
        searchBox?.select();
        break;
      case "r":
        void app.refreshList();
        void app.refreshIssue();
        break;
      case "b":
        app.sidebarOpen = !app.sidebarOpen;
        break;
      case "c":
        if (app.issue) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("jirafast:comment"));
        }
        break;
      case "u":
        app.back();
        break;
      case "?":
        showHelp = !showHelp;
        break;
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if app.screen === "loading"}
  <div class="center muted">Loading…</div>
{:else if app.screen === "connect"}
  <Connect />
{:else}
  <div class="layout" class:focus={app.focus} class:no-sidebar={!app.sidebarOpen}>
    {#if !app.focus && app.sidebarOpen}
      <Sidebar />
    {/if}
    {#if !app.focus}
      <IssueList bind:searchBox />
    {/if}
    <IssueView />
  </div>
{/if}

<Toast />
{#if showHelp}
  <ShortcutsHelp onclose={() => (showHelp = false)} />
{/if}

<style>
  .layout {
    display: grid;
    grid-template-columns: 220px minmax(320px, 420px) 1fr;
    height: 100vh;
    overflow: hidden;
  }
  .layout.no-sidebar {
    grid-template-columns: minmax(320px, 420px) 1fr;
  }
  .layout.focus {
    grid-template-columns: 1fr;
  }
  .center {
    display: grid;
    place-items: center;
    height: 100vh;
  }
</style>
