import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import css from "./Picker.module.css";

export interface PickerOption {
  id: string;
  label: string;
  /** Secondary text shown dimmed next to the label (username, issue summary…). */
  hint?: string;
  iconUrl?: string;
}

interface Props {
  /** Selected option ids (at most one unless `multiple`). */
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  /** Static option list, filtered locally as you type. */
  options?: PickerOption[];
  /** Remote lookup, debounced; results are merged with any local matches. */
  search?: (query: string) => Promise<PickerOption[]>;
  /** Minimum query length before `search` is called (default 1; 0 = also on focus). */
  minChars?: number;
  /** Let Enter/comma/space commit free text that matches no option (labels, usernames). */
  allowCustom?: boolean;
  /** Free-text token normaliser, e.g. lowercase / strip spaces. */
  normalize?: (text: string) => string;
  placeholder?: string;
  disabled?: boolean;
  /** Extra actions rendered below the input (e.g. "Me", "Unassign"). */
  actions?: ReactNode;
  /** Shown for a selected id that no option describes (e.g. an issue key the user typed). */
  labelFor?: (id: string) => string | undefined;
  inputRef?: (el: HTMLInputElement | null) => void;
}

const DEBOUNCE_MS = 200;

function matches(o: PickerOption, q: string): boolean {
  if (!q) return true;
  return o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false) || o.id.toLowerCase() === q;
}

/**
 * Searchable combobox / token input shared by all field editors. Works with a
 * local option list (filtered as you type), a remote search, or both. Single
 * mode shows the chosen value inside the input; multiple mode renders chips.
 */
export default function Picker({
  value,
  onChange,
  multiple = false,
  options = [],
  search,
  minChars = 1,
  allowCustom = false,
  normalize,
  placeholder,
  disabled,
  actions,
  labelFor,
  inputRef
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<PickerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const known = useRef(new Map<string, PickerOption>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seq = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  for (const o of options) known.current.set(o.id, o);
  for (const o of remote) known.current.set(o.id, o);

  const display = (id: string) => known.current.get(id)?.label ?? labelFor?.(id) ?? id;

  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    const seen = new Set<string>();
    const out: PickerOption[] = [];
    for (const o of [...options.filter((o) => matches(o, q)), ...remote]) {
      if (seen.has(o.id) || (multiple && value.includes(o.id))) continue;
      seen.add(o.id);
      out.push(o);
    }
    return out.slice(0, 50);
  }, [options, remote, q, multiple, value]);

  const single = !multiple ? (value[0] ?? "") : "";
  const custom = allowCustom ? (normalize ? normalize(query) : query.trim()) : "";
  const showCustom = Boolean(custom) && !hits.some((h) => h.id.toLowerCase() === custom.toLowerCase()) && !value.includes(custom);
  const rows = showCustom ? hits.length + 1 : hits.length;

  useEffect(() => {
    if (!search || !open) return;
    clearTimeout(timer.current);
    if (q.length < minChars) {
      setRemote([]);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await search(query.trim());
        if (id === seq.current) setRemote(res);
      } catch {
        if (id === seq.current) setRemote([]);
      } finally {
        if (id === seq.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [search, open, q, query, minChars]);

  useEffect(() => {
    setActive(0);
  }, [q, remote]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    setRemote([]);
  }

  function pick(id: string) {
    if (multiple) {
      if (!value.includes(id)) onChange([...value, id]);
      setQuery("");
      setRemote([]);
      input.current?.focus();
    } else {
      onChange([id]);
      close();
    }
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id));
    input.current?.focus();
  }

  function commitActive(): boolean {
    if (!open) return false;
    if (active < hits.length) {
      pick(hits[active].id);
      return true;
    }
    if (showCustom) {
      pick(custom);
      return true;
    }
    return false;
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && !multiple && single && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setQuery(e.key);
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (rows) setActive((a) => (a + 1) % rows);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows) setActive((a) => (a - 1 + rows) % rows);
    } else if (e.key === "Enter") {
      if (commitActive()) e.preventDefault();
      else if (allowCustom && custom) {
        e.preventDefault();
        pick(custom);
      }
    } else if (e.key === "Tab") {
      if (open && query && commitActive()) e.preventDefault();
    } else if ((e.key === "," || (e.key === " " && !search)) && allowCustom && multiple) {
      if (custom) {
        e.preventDefault();
        pick(custom);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === "Backspace" && !query && value.length) {
      if (multiple) {
        e.preventDefault();
        remove(value[value.length - 1]);
      } else if (!open) {
        e.preventDefault();
        onChange([]);
        setOpen(true);
      }
    }
  }

  const inputValue = open || multiple ? query : single ? display(single) : "";

  return (
    <div ref={root} className={`${css.picker} ${multiple ? css.multi : ""}`} data-picker-open={open || undefined}>
      <div className={css.field} onClick={() => input.current?.focus()}>
        {multiple &&
          value.map((id) => (
            <span key={id} className={css.chip} title={id}>
              {display(id)}
              {!disabled && (
                <button
                  type="button"
                  className={css.x}
                  aria-label={`Remove ${display(id)}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => remove(id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        <input
          ref={(el) => {
            input.current = el;
            inputRef?.(el);
          }}
          className={css.input}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={inputValue}
          placeholder={multiple && value.length ? "" : placeholder}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKey}
        />
        {!multiple && single && !disabled && !open && (
          <button type="button" className={css.x} aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange([])}>
            ×
          </button>
        )}
        {busy && <span className={`spin ${css.spin}`}></span>}
      </div>
      {open && (rows > 0 || (q.length >= minChars && !busy && search)) && (
        <ul id={listId} role="listbox" className={css.menu}>
          {hits.map((o, i) => (
            <li
              key={o.id}
              role="option"
              aria-selected={i === active}
              className={`${css.item} ${i === active ? css.active : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.id)}
            >
              {o.iconUrl && <img className={css.icon} src={o.iconUrl} alt="" />}
              <span className={css.label}>{o.label}</span>
              {o.hint && <span className={`muted ${css.hint}`}>{o.hint}</span>}
            </li>
          ))}
          {showCustom && (
            <li
              role="option"
              aria-selected={active === hits.length}
              className={`${css.item} ${active === hits.length ? css.active : ""}`}
              onMouseEnter={() => setActive(hits.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(custom)}
            >
              <span className={css.label}>{custom}</span>
              <span className={`muted ${css.hint}`}>{allowCustom && search ? "use as typed" : "new"}</span>
            </li>
          )}
          {rows === 0 && <li className={`${css.item} ${css.empty} muted`}>No matches</li>}
        </ul>
      )}
      {actions && <div className={css.actions}>{actions}</div>}
    </div>
  );
}
