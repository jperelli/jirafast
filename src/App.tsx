import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { app, useApp, useAppShallow } from "./lib/store";
import Connect from "./components/Connect";
import Sidebar from "./components/Sidebar";
import IssueList from "./components/IssueList";
import IssueView from "./components/IssueView";
import KanbanBoard from "./components/KanbanBoard";
import Lightbox from "./components/Lightbox";
import Toast from "./components/Toast";
import ShortcutsHelp from "./components/ShortcutsHelp";
import css from "./App.module.css";

// The editor pulls in TipTap/ProseMirror; keep it out of the startup bundle.
const IssueEditor = lazy(() => import("./components/IssueEditor"));

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

async function toggleFullscreen() {
  const w = getCurrentWindow();
  await w.setFullscreen(!(await w.isFullscreen()));
}

export default function App() {
  const { screen, focus, sidebarOpen, view, hasIssue } = useAppShallow((s) => ({
    screen: s.screen,
    focus: s.focus,
    sidebarOpen: s.sidebarOpen,
    view: s.view,
    hasIssue: s.selectedKey !== null,
  }));
  const editor = useApp((s) => s.editor);
  const [showHelp, setShowHelp] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void app.init();
  }, []);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
        return;
      }
      const s = app.state;
      if (s.screen !== "main" || s.editor || s.lightbox) return;
      if (e.key === "Escape") {
        if (showHelp) setShowHelp(false);
        else if (isTyping(e)) (e.target as HTMLElement).blur();
        else if (s.focus) app.setFocus(false);
        else if (s.view === "board" && s.selectedKey) app.closeIssue();
        return;
      }
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (e.key === "ArrowDown" && s.focus) return;
          e.preventDefault();
          app.selectRelative(1);
          break;
        case "k":
        case "ArrowUp":
          if (e.key === "ArrowUp" && s.focus) return;
          e.preventDefault();
          app.selectRelative(-1);
          break;
        case "f":
          if (s.selectedKey) app.toggleFocus();
          break;
        case "/":
          e.preventDefault();
          app.setFocus(false);
          if (s.view === "board") app.closeIssue();
          // The list/board mounts on the next frame when leaving focus mode.
          requestAnimationFrame(() => {
            searchBox.current?.focus();
            searchBox.current?.select();
          });
          break;
        case "r":
          void app.refreshList();
          void app.refreshIssue();
          break;
        case "b":
          app.toggleSidebar();
          break;
        case "c":
          if (s.issue) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("jirafast:comment"));
          }
          break;
        case "u":
          app.back();
          break;
        case "e":
          if (s.selectedKey) {
            e.preventDefault();
            app.editIssue();
          }
          break;
        case "n":
          e.preventDefault();
          app.newIssue();
          break;
        case "?":
          setShowHelp((v) => !v);
          break;
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [showHelp]);

  return (
    <>
      {screen === "loading" ? (
        <div className={`${css.center} muted`}>Loading…</div>
      ) : screen === "connect" ? (
        <Connect />
      ) : (
        <>
          <div
            className={`${css.layout} ${focus ? css.focus : ""} ${!sidebarOpen ? css.noSidebar : ""} ${view === "board" ? css.board : ""}`}
          >
            {!focus && sidebarOpen && <Sidebar />}
            {view === "board" ? (
              hasIssue ? (
                <IssueView />
              ) : (
                <KanbanBoard searchBox={searchBox} />
              )
            ) : (
              <>
                {!focus && <IssueList searchBox={searchBox} />}
                <IssueView />
              </>
            )}
          </div>
          {editor && (
            <Suspense fallback={<div className={`${css.overlay} muted`}>Loading editor…</div>}>
              <IssueEditor key={editor.kind === "edit" ? `edit:${editor.key}` : `create:${editor.projectKey ?? ""}`} mode={editor} />
            </Suspense>
          )}
          <Lightbox />
        </>
      )}

      <Toast />
      {showHelp && <ShortcutsHelp onClose={() => setShowHelp(false)} />}
    </>
  );
}
