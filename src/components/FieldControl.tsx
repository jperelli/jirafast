import { childOptions, optionLabel, type Cascading, type FieldValue, type GenericField, type TimeTracking } from "../lib/fields";
import type { JiraUser } from "../lib/types";
import css from "./IssueEditor.module.css";

interface Props {
  field: GenericField;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  /** On create, selects offer an empty "Default" choice. */
  allowEmpty: boolean;
  me: JiraUser | null;
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Form control for any field described by Jira's editmeta, chosen from its schema. */
export default function FieldControl({ field, value, onChange, allowEmpty, me }: Props) {
  const { meta, kind } = field;
  const label = (
    <span>
      {meta.name}
      {meta.required && <span className={css.req}> *</span>}
    </span>
  );
  const options = meta.allowedValues ?? [];
  const str = typeof value === "string" ? value : "";

  switch (kind) {
    case "text":
      return (
        <label>
          {label}
          <input value={str} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
        </label>
      );
    case "textarea":
      return (
        <label>
          {label}
          <textarea value={str} onChange={(e) => onChange(e.target.value)} rows={3} placeholder="Wiki markup"></textarea>
        </label>
      );
    case "number":
      return (
        <label>
          {label}
          <input type="number" step="any" value={str} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "date":
      return (
        <label>
          {label}
          <input type="date" value={str} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "datetime":
      return (
        <label>
          {label}
          <input type="datetime-local" value={str} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "select":
      return (
        <label>
          {label}
          <select value={str} onChange={(e) => onChange(e.target.value)}>
            {(allowEmpty || !meta.required || !str) && <option value="">{allowEmpty ? "Default" : "None"}</option>}
            {options.map((o) => (
              <option key={o.id ?? optionLabel(o)} value={o.id ?? optionLabel(o)}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </label>
      );
    case "multiselect": {
      const list = Array.isArray(value) ? value : [];
      return (
        <fieldset>
          <legend>
            {meta.name}
            {meta.required && <span className={css.req}> *</span>}
          </legend>
          {options.map((o) => {
            const id = o.id ?? optionLabel(o);
            return (
              <label key={id} className={css.check}>
                <input type="checkbox" checked={list.includes(id)} onChange={() => onChange(toggleIn(list, id))} />
                {optionLabel(o)}
              </label>
            );
          })}
        </fieldset>
      );
    }
    case "strings":
      return (
        <label>
          {label}
          <input value={str} onChange={(e) => onChange(e.target.value)} placeholder="space separated" spellCheck={false} />
        </label>
      );
    case "user":
    case "users":
      return (
        <label>
          {label}
          <input
            value={str}
            onChange={(e) => onChange(e.target.value)}
            placeholder={kind === "users" ? "usernames, space separated" : "username"}
            spellCheck={false}
            autoComplete="off"
          />
          {me && (
            <div className={css.row}>
              <button className={`ghost ${css.small}`} onClick={() => onChange(kind === "users" ? `${str} ${me.name}`.trim() : me.name)}>
                Me
              </button>
            </div>
          )}
        </label>
      );
    case "cascading": {
      const c = (typeof value === "object" && !Array.isArray(value) && "parent" in value ? value : { parent: "", child: "" }) as Cascading;
      const children = childOptions(meta, c.parent);
      return (
        <label>
          {label}
          <select value={c.parent} onChange={(e) => onChange({ parent: e.target.value, child: "" })}>
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
          {children.length > 0 && (
            <select value={c.child} onChange={(e) => onChange({ parent: c.parent, child: e.target.value })}>
              <option value="">None</option>
              {children.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionLabel(o)}
                </option>
              ))}
            </select>
          )}
        </label>
      );
    }
    case "timetracking": {
      const t = (typeof value === "object" && !Array.isArray(value) && "originalEstimate" in value ? value : { originalEstimate: "", remainingEstimate: "" }) as TimeTracking;
      return (
        <fieldset>
          <legend>{meta.name}</legend>
          <label>
            <span>Original estimate</span>
            <input value={t.originalEstimate} onChange={(e) => onChange({ ...t, originalEstimate: e.target.value })} placeholder="e.g. 2w 3d 4h" spellCheck={false} />
          </label>
          <label>
            <span>Remaining estimate</span>
            <input value={t.remainingEstimate} onChange={(e) => onChange({ ...t, remainingEstimate: e.target.value })} placeholder="e.g. 4h 30m" spellCheck={false} />
          </label>
        </fieldset>
      );
    }
    default:
      return (
        <label>
          {label}
          <input value={str} disabled title={`Field type ${meta.schema?.custom ?? meta.schema?.type ?? "unknown"} can't be edited here`} />
          <div className={`muted ${css.current}`}>Not editable here ({meta.schema?.items ? `${meta.schema.type} of ${meta.schema.items}` : (meta.schema?.type ?? "unknown")})</div>
        </label>
      );
  }
}
