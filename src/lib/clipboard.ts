import { readText as pluginReadText, writeHtml as pluginWriteHtml, writeText as pluginWriteText } from "@tauri-apps/plugin-clipboard-manager";

/** System clipboard via the Tauri plugin, falling back to the web API in plain-browser dev. */
export async function readClipboardText(): Promise<string> {
  try {
    return (await pluginReadText()) ?? "";
  } catch {
    return navigator.clipboard.readText();
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await pluginWriteText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export async function writeClipboardHtml(html: string, plain: string): Promise<void> {
  try {
    await pluginWriteHtml(html, plain);
  } catch {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  }
}
