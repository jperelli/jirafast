<script lang="ts">
  import { app } from "../lib/store.svelte";
</script>

{#if app.toast}
  <div class="toast {app.toast.kind}" role="status">{app.toast.text}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--fg);
    color: var(--bg);
    padding: 8px 14px;
    border-radius: 6px;
    box-shadow: var(--shadow);
    font-size: 13px;
    max-width: min(700px, 90vw);
    z-index: 100;
    word-break: break-word;
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
</style>
