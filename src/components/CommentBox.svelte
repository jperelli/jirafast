<script lang="ts">
  import { onMount, tick } from "svelte";
  import { app } from "../lib/store.svelte";
  import { api, errorMessage } from "../lib/api";

  let { key }: { key: string } = $props();

  let body = $state("");
  let busy = $state(false);
  let open = $state(false);
  let textarea = $state<HTMLTextAreaElement | null>(null);

  // Drafts survive switching issues back and forth.
  const drafts = new Map<string, string>();
  $effect(() => {
    const draft = drafts.get(key) ?? "";
    body = draft;
    open = draft.length > 0;
  });

  function onInput() {
    drafts.set(key, body);
  }

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    busy = true;
    try {
      await api.addComment(key, text);
      drafts.delete(key);
      body = "";
      open = false;
      app.notify("Comment added");
      await app.refreshIssue();
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      busy = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  async function focus() {
    open = true;
    await tick();
    textarea?.focus();
    textarea?.scrollIntoView({ block: "center" });
  }

  onMount(() => {
    window.addEventListener("jirafast:comment", focus);
    return () => window.removeEventListener("jirafast:comment", focus);
  });
</script>

<div class="box" class:open>
  {#if !open}
    <button class="placeholder" onclick={focus}>Add a comment… <span class="muted">(c)</span></button>
  {:else}
    <textarea
      bind:this={textarea}
      bind:value={body}
      oninput={onInput}
      onkeydown={onKeydown}
      rows={app.focus ? 8 : 5}
      placeholder="Write a comment in Jira wiki markup: *bold*, _italic_, {'{code}'}…{'{code}'}, [~username]"
      disabled={busy}
    ></textarea>
    <div class="actions">
      <span class="muted hint">Wiki markup · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to post</span>
      <span class="grow"></span>
      <button class="ghost" onclick={() => { open = false; }} disabled={busy}>Cancel</button>
      <button class="primary" onclick={submit} disabled={busy || !body.trim()}>
        {#if busy}<span class="spin"></span>{/if} Comment
      </button>
    </div>
  {/if}
</div>

<style>
  .box {
    margin-top: 22px;
  }
  .placeholder {
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: 2px solid var(--border);
    padding: 10px 12px;
    color: var(--fg-2);
  }
  .placeholder:hover {
    border-color: var(--accent);
    filter: none;
  }
  textarea {
    width: 100%;
    resize: vertical;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.5;
    padding: 10px 12px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .hint {
    font-size: 12px;
  }
  .grow {
    flex: 1;
  }
</style>
