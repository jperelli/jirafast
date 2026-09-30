import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import css from "./RichEditor.module.css";

/**
 * Keeps Jira's original image URL so the markup converter can name the
 * attachment, and marks images whose upload is still in flight.
 */
const JiraImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      origSrc: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-orig-src"),
        renderHTML: (attrs: { origSrc?: string | null }) => (attrs.origSrc ? { "data-orig-src": attrs.origSrc } : {}),
      },
      uploadId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-upload-id"),
        renderHTML: (attrs: { uploadId?: string | null }) => (attrs.uploadId ? { "data-upload-id": attrs.uploadId } : {}),
      },
    };
  },
}).configure({ inline: true, allowBase64: false });

/** An image the user pasted or dropped; shown from `src` until it is attached to the issue. */
export interface PastedImage {
  uploadId: string;
  file: File;
  src: string;
}

function imageFiles(list: FileList | DataTransferItemList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (let i = 0; i < list.length; i++) {
    const item: File | DataTransferItem = list[i];
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && file.type.startsWith("image/")) out.push(file);
  }
  return out;
}

const newUploadId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const isBlobUrl = (src: unknown): src is string => typeof src === "string" && /^blob:/i.test(src);

interface PastedImagesOptions {
  onImage: (img: PastedImage) => void;
}

/**
 * Routes pasted/dropped images to `onImage`. Chromium hands the files over in
 * the paste/drop event; WebKit (Linux, macOS) exposes nothing there and instead
 * lets the default paste insert `<img src="blob:…">`, so any unclaimed `blob:`
 * image that appears in the document is tagged with an upload id and read back
 * through `fetch`. Either way Jira never sees the local URL.
 */
const PastedImages = Extension.create<PastedImagesOptions>({
  name: "pastedImages",

  addOptions() {
    return { onImage: () => {} };
  },

  addProseMirrorPlugins() {
    const onImage = (img: PastedImage) => this.options.onImage(img);
    const insertFiles = (view: EditorView, files: File[]) => {
      const type = view.state.schema.nodes.image;
      const tr = view.state.tr;
      const pending: PastedImage[] = [];
      for (const file of files) {
        const uploadId = newUploadId();
        const src = URL.createObjectURL(file);
        tr.replaceSelectionWith(type.create({ src, uploadId }));
        pending.push({ uploadId, file, src });
      }
      view.dispatch(tr.scrollIntoView());
      pending.forEach(onImage);
    };
    return [
      new Plugin({
        props: {
          handlePaste: (view, e) => {
            const files = imageFiles(e.clipboardData?.files);
            if (!files.length) return false;
            insertFiles(view, files);
            return true;
          },
          handleDrop: (view, e, _slice, moved) => {
            const files = imageFiles(e.dataTransfer?.files);
            if (moved || !files.length) return false;
            const pos = view.posAtCoords({ left: e.clientX, top: e.clientY });
            if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
            insertFiles(view, files);
            return true;
          },
        },
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((tr) => tr.docChanged)) return null;
          const claimed: { pos: number; src: string; uploadId: string }[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name === "image" && !node.attrs.uploadId && !node.attrs.origSrc && isBlobUrl(node.attrs.src)) {
              claimed.push({ pos, src: node.attrs.src, uploadId: newUploadId() });
            }
          });
          if (!claimed.length) return null;
          const tr = state.tr;
          for (const c of claimed) tr.setNodeMarkup(c.pos, undefined, { ...state.doc.nodeAt(c.pos)!.attrs, uploadId: c.uploadId });
          for (const c of claimed) {
            void fetch(c.src)
              .then((r) => r.blob())
              .then((blob) => onImage({ uploadId: c.uploadId, file: new File([blob], "", { type: blob.type }), src: c.src }));
          }
          return tr;
        },
      }),
    ];
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    codeBlock: { HTMLAttributes: {} },
    link: { openOnClick: false, autolink: true, linkOnPaste: true },
  }),
  JiraImage,
  TableKit.configure({ table: { resizable: false } }),
  Placeholder.configure({ placeholder: "Description — use the toolbar or type **bold**, # heading, - list, ``` code" }),
];

export interface RichEditorProps {
  /** HTML to load. Only read on mount and when `contentKey` changes. */
  html: string;
  contentKey: string | number;
  onChange: (editor: Editor) => void;
  onReady?: (editor: Editor) => void;
  /** Always points at the live editor instance (or null while unmounted). */
  editorRef?: RefObject<Editor | null>;
  onImageClick?: (src: string, alt: string) => void;
  /** Called for every pasted/dropped image; the caller attaches it to the issue. */
  onImageFile?: (img: PastedImage) => void;
  fontSize: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

export default function RichEditor({ html, contentKey, onChange, onReady, editorRef, onImageClick, onImageFile, fontSize, disabled, autoFocus }: RichEditorProps) {
  const imageFileRef = useRef(onImageFile);
  imageFileRef.current = onImageFile;
  const editor = useEditor(
    {
      extensions: [...extensions, PastedImages.configure({ onImage: (img) => imageFileRef.current?.(img) })],
      content: html,
      editable: !disabled,
      autofocus: autoFocus ? "start" : false,
      onUpdate: ({ editor }) => onChange(editor),
      onCreate: ({ editor }) => onReady?.(editor),
      editorProps: {
        attributes: { class: `jira-html ${css.prose}`, spellcheck: "true" },
        handleDOMEvents: {
          click: (_view, e) => {
            const img = (e.target as HTMLElement).closest("img");
            if (img && onImageClick && (e.ctrlKey || e.metaKey || e.detail === 2)) {
              onImageClick(img.currentSrc || img.src, img.alt);
              return true;
            }
            return false;
          },
        },
      },
    },
    [contentKey],
  );

  useEffect(() => {
    if (editor && editor.isEditable === Boolean(disabled)) editor.setEditable(!disabled, false);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  return (
    <div className={css.wrap} style={{ "--editor-font-size": `${fontSize}px` } as CSSProperties}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className={css.content} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      const heading = [1, 2, 3, 4, 5, 6].find((l) => e.isActive("heading", { level: l })) ?? 0;
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        link: e.isActive("link"),
        heading,
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        quote: e.isActive("blockquote"),
        codeBlock: e.isActive("codeBlock"),
        table: e.isActive("table"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });
  if (!editor || !st) return <div className={css.toolbar}></div>;

  const c = () => editor.chain().focus();

  function setLink() {
    const prev = editor!.getAttributes("link").href as string | undefined;
    const href = window.prompt("Link URL", prev ?? "https://");
    if (href === null) return;
    if (!href.trim()) c().extendMarkRange("link").unsetLink().run();
    else c().extendMarkRange("link").setLink({ href: href.trim() }).run();
  }

  const btn = (label: string, title: string, on: boolean, run: () => void, disabled = false) => (
    <button type="button" className={`${css.tb} ${on ? css.on : ""}`} title={title} onMouseDown={(e) => e.preventDefault()} onClick={run} disabled={disabled}>
      {label}
    </button>
  );

  return (
    <div className={css.toolbar} role="toolbar">
      <select
        className={css.block}
        value={st.codeBlock ? "code" : st.heading ? `h${st.heading}` : "p"}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") c().setParagraph().run();
          else if (v === "code") c().setCodeBlock().run();
          else c().setHeading({ level: Number(v[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
        }}
        title="Block type"
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
        <option value="h5">Heading 5</option>
        <option value="h6">Heading 6</option>
        <option value="code">Code block</option>
      </select>
      <span className={css.sep} />
      {btn("B", "Bold (Ctrl+B)", st.bold, () => c().toggleBold().run())}
      {btn("I", "Italic (Ctrl+I)", st.italic, () => c().toggleItalic().run())}
      {btn("U", "Underline (Ctrl+U)", st.underline, () => c().toggleUnderline().run())}
      {btn("S", "Strikethrough", st.strike, () => c().toggleStrike().run())}
      {btn("</>", "Inline code (Ctrl+E)", st.code, () => c().toggleCode().run())}
      {btn("Link", "Link (Ctrl+K)", st.link, setLink)}
      <span className={css.sep} />
      {btn("•", "Bullet list", st.bullet, () => c().toggleBulletList().run())}
      {btn("1.", "Numbered list", st.ordered, () => c().toggleOrderedList().run())}
      {btn("❝", "Quote", st.quote, () => c().toggleBlockquote().run())}
      {btn("―", "Horizontal rule", false, () => c().setHorizontalRule().run())}
      <span className={css.sep} />
      {st.table ? (
        <>
          {btn("+col", "Add column after", false, () => c().addColumnAfter().run())}
          {btn("+row", "Add row after", false, () => c().addRowAfter().run())}
          {btn("−col", "Delete column", false, () => c().deleteColumn().run())}
          {btn("−row", "Delete row", false, () => c().deleteRow().run())}
          {btn("⊞", "Toggle header row", false, () => c().toggleHeaderRow().run())}
          {btn("✕⊞", "Delete table", false, () => c().deleteTable().run())}
        </>
      ) : (
        btn("⊞", "Insert table", false, () => c().insertTable({ rows: 2, cols: 3, withHeaderRow: true }).run())
      )}
      <span className={css.grow} />
      {btn("↶", "Undo (Ctrl+Z)", false, () => c().undo().run(), !st.canUndo)}
      {btn("↷", "Redo (Ctrl+Shift+Z)", false, () => c().redo().run(), !st.canRedo)}
    </div>
  );
}
