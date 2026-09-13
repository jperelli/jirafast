<script lang="ts">
  import { app } from "../lib/store.svelte";
  import { errorMessage } from "../lib/api";
  import type { SettingsInput } from "../lib/types";
  import { onMount } from "svelte";

  let baseUrl = $state(app.settings?.base_url ?? "");
  let kind = $state<"pat" | "basic">(app.settings?.auth_kind ?? "pat");
  let token = $state("");
  let username = $state(app.settings?.username ?? "");
  let password = $state("");
  let acceptInvalidCerts = $state(app.settings?.accept_invalid_certs ?? false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let urlInput = $state<HTMLInputElement | null>(null);

  onMount(() => urlInput?.focus());

  const canSubmit = $derived(
    baseUrl.trim().length > 0 && (kind === "pat" ? token.trim().length > 0 : username.trim().length > 0 && password.length > 0),
  );

  async function submit(e: Event) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    busy = true;
    error = null;
    const input: SettingsInput = {
      base_url: baseUrl.trim(),
      auth: kind === "pat" ? { kind: "pat", token: token.trim() } : { kind: "basic", username: username.trim(), password },
      accept_invalid_certs: acceptInvalidCerts,
    };
    try {
      await app.connect(input);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form class="card" onsubmit={submit}>
    <h1>jirafast</h1>
    <p class="muted">Connect to your Jira Server / Data Center instance (tested with Jira 10.3).</p>

    <label>
      <span>Jira URL</span>
      <input
        type="url"
        bind:this={urlInput}
        bind:value={baseUrl}
        placeholder="https://jira.example.com  or  https://host/jira"
        autocomplete="url"
        required
      />
      <small class="muted">Include the context path if your Jira lives under one (e.g. <code>/jira</code>).</small>
    </label>

    <div class="tabs" role="tablist">
      <button type="button" class:active={kind === "pat"} onclick={() => (kind = "pat")}>Personal Access Token</button>
      <button type="button" class:active={kind === "basic"} onclick={() => (kind = "basic")}>Username &amp; password</button>
    </div>

    {#if kind === "pat"}
      <label>
        <span>Personal Access Token</span>
        <input type="password" bind:value={token} autocomplete="off" required />
        <small class="muted">
          Create one in Jira under <em>Profile → Personal Access Tokens</em>. Recommended.
        </small>
      </label>
    {:else}
      <label>
        <span>Username</span>
        <input type="text" bind:value={username} autocomplete="username" required />
      </label>
      <label>
        <span>Password</span>
        <input type="password" bind:value={password} autocomplete="current-password" required />
      </label>
    {/if}

    <label class="row">
      <input type="checkbox" bind:checked={acceptInvalidCerts} />
      <span>Accept self-signed / invalid TLS certificates</span>
    </label>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <button class="primary" type="submit" disabled={!canSubmit || busy}>
      {#if busy}<span class="spin"></span> Connecting…{:else}Connect{/if}
    </button>
    <small class="muted">
      Credentials are stored locally in the app config directory (user-readable only) and only ever sent to the URL above.
    </small>
  </form>
</div>

<style>
  .wrap {
    height: 100vh;
    display: grid;
    place-items: center;
    background: var(--bg-2);
    overflow: auto;
  }
  .card {
    width: min(460px, 92vw);
    background: var(--bg);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 28px 28px 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  h1 {
    margin: 0;
    font-size: 24px;
    letter-spacing: -0.02em;
  }
  h1 + p {
    margin: -8px 0 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label > span {
    font-weight: 600;
    font-size: 12px;
    color: var(--fg-2);
  }
  label.row {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  label.row > span {
    font-weight: 400;
    font-size: 13px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    background: none;
    border-radius: 0;
    border-bottom: 2px solid transparent;
    padding: 6px 10px;
    color: var(--muted);
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 10px;
    border-radius: var(--radius);
    font-size: 13px;
  }
  button.primary {
    padding: 8px;
    font-weight: 600;
  }
</style>
