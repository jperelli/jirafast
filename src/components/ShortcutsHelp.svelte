<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();

  const rows: Array<[string, string]> = [
    ["j / ↓", "Next issue"],
    ["k / ↑", "Previous issue"],
    ["f", "Toggle focus mode (issue fills the window)"],
    ["F11", "Toggle OS fullscreen"],
    ["/", "Search (text, issue key or JQL)"],
    ["c", "Add a comment"],
    ["r", "Refresh list and issue"],
    ["u", "Back to the previous issue"],
    ["b", "Toggle sidebar"],
    ["Esc", "Leave focus mode / blur input"],
    ["Ctrl + / Ctrl −", "Zoom text"],
    ["?", "This help"],
  ];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="backdrop" onclick={onclose}>
  <div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts" tabindex="-1">
    <h2>Keyboard shortcuts</h2>
    <table>
      <tbody>
        {#each rows as [keys, what] (keys)}
          <tr>
            <td class="keys">{#each keys.split(" / ") as k, i (k)}{#if i}<span class="or"> / </span>{/if}<kbd>{k}</kbd>{/each}</td>
            <td>{what}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onclose}>Close</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(9, 30, 66, 0.4);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .dialog {
    background: var(--bg);
    border-radius: 8px;
    box-shadow: var(--shadow);
    padding: 20px 24px;
    min-width: 380px;
  }
  h2 {
    margin: 0 0 12px;
    font-size: 16px;
  }
  table {
    border-collapse: collapse;
    margin-bottom: 14px;
  }
  td {
    padding: 4px 10px 4px 0;
    font-size: 13px;
  }
  .keys {
    white-space: nowrap;
    color: var(--muted);
  }
  .or {
    font-size: 11px;
  }
</style>
