<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { app } from "../lib/store.svelte";
  import { prepareJiraHtml } from "../lib/html";

  let { html, class: cls = "" }: { html: string | null | undefined; class?: string } = $props();

  const prepared = $derived(prepareJiraHtml(html, app.baseUrl));

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const key = a.dataset.issueKey;
    if (key && !e.ctrlKey && !e.metaKey) {
      void app.openIssue(key);
      return;
    }
    const href = a.dataset.href ?? a.getAttribute("href");
    if (href && href !== "#") void openUrl(href).catch((err) => app.notify(String(err), "error"));
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="jira-html {cls}" onclick={onClick}>
  {@html prepared}
</div>
