import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { app, useApp } from "../lib/store";
import { api, errorMessage } from "../lib/api";
import css from "./CommentBox.module.css";

// Drafts survive switching issues back and forth.
const drafts = new Map<string, string>();

export default function CommentBox({ issueKey }: { issueKey: string }) {
  const focusMode = useApp((s) => s.focus);
  const [body, setBody] = useState(() => drafts.get(issueKey) ?? "");
  const [open, setOpen] = useState(() => (drafts.get(issueKey) ?? "").length > 0);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef(false);

  useEffect(() => {
    const draft = drafts.get(issueKey) ?? "";
    setBody(draft);
    setOpen(draft.length > 0);
  }, [issueKey]);

  useEffect(() => {
    if (open && pendingFocus.current) {
      pendingFocus.current = false;
      textarea.current?.focus();
      textarea.current?.scrollIntoView({ block: "center" });
    }
  }, [open]);

  useEffect(() => {
    function focus() {
      pendingFocus.current = true;
      setOpen(true);
      // Already open: the effect above won't re-run, focus directly.
      if (textarea.current) {
        pendingFocus.current = false;
        textarea.current.focus();
        textarea.current.scrollIntoView({ block: "center" });
      }
    }
    window.addEventListener("jirafast:comment", focus);
    return () => window.removeEventListener("jirafast:comment", focus);
  }, []);

  function onChange(value: string) {
    setBody(value);
    drafts.set(issueKey, value);
  }

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.addComment(issueKey, text);
      drafts.delete(issueKey);
      setBody("");
      setOpen(false);
      app.notify("Comment added");
      await app.refreshIssue();
    } catch (e) {
      app.notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className={css.box}>
      {!open ? (
        <button
          className={css.placeholder}
          onClick={() => {
            pendingFocus.current = true;
            setOpen(true);
          }}
        >
          Add a comment… <span className="muted">(c)</span>
        </button>
      ) : (
        <>
          <textarea
            ref={textarea}
            className={css.textarea}
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={focusMode ? 8 : 5}
            placeholder="Write a comment in Jira wiki markup: *bold*, _italic_, {code}…{code}, [~username]"
            disabled={busy}
          ></textarea>
          <div className={css.actions}>
            <span className={`muted ${css.hint}`}>
              Wiki markup · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to post
            </span>
            <span className={css.grow}></span>
            <button className="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button className="primary" onClick={submit} disabled={busy || !body.trim()}>
              {busy && <span className="spin"></span>} Comment
            </button>
          </div>
        </>
      )}
    </div>
  );
}
