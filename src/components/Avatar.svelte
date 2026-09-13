<script lang="ts">
  import { app } from "../lib/store.svelte";
  import { toAssetUrl } from "../lib/html";
  import { initials } from "../lib/format";
  import type { JiraUser } from "../lib/types";

  let { user, size = 24 }: { user: JiraUser; size?: number } = $props();

  const src = $derived.by(() => {
    const urls = user.avatarUrls;
    const raw = urls?.["48x48"] ?? urls?.["32x32"] ?? urls?.["24x24"] ?? urls?.["16x16"];
    return raw ? toAssetUrl(raw, app.baseUrl) ?? raw : null;
  });
  let failed = $state(false);
</script>

{#if src && !failed}
  <img
    class="avatar"
    {src}
    alt=""
    title={user.displayName}
    width={size}
    height={size}
    style="width:{size}px;height:{size}px"
    onerror={() => (failed = true)}
  />
{:else}
  <span class="avatar fallback" title={user.displayName} style="width:{size}px;height:{size}px;font-size:{Math.max(8, size * 0.42)}px">
    {initials(user.displayName)}
  </span>
{/if}

<style>
  .avatar {
    border-radius: 50%;
    flex: none;
    object-fit: cover;
    background: var(--bg-3);
  }
  .fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    color: var(--fg-2);
  }
</style>
