import { useMemo } from "react";
import { childOptions, listValue, type Cascading, type FieldValue, type GenericField, type TimeTracking } from "../lib/fields";
import { allowedOptions, issueSearcher, labelSearcher, normalizeLabel, rawLabels, searchGroups, searchUsers } from "../lib/pickers";
import type { JiraUser } from "../lib/types";
import Picker from "./Picker";
import css from "./IssueEditor.module.css";

interface Props {
  field: GenericField;
  value: FieldValue;
  onChange: (v: FieldValue) => void;
  /** On create, selects offer an empty "Default" choice. */
  allowEmpty: boolean;
  me: JiraUser | null;
  /** Issue being edited (scopes label suggestions); absent on create. */
  issueId?: string;
  /** Project of the issue, used to scope issue pickers. */
  projectKey?: string;
  /** The issue's raw value for this field, for display names of pre-selected users/groups. */
  raw?: unknown;
}

/** Form control for any field described by Jira's editmeta, chosen from its schema. */
export default function FieldControl({ field, value, onChange, allowEmpty, me, issueId, projectKey, raw }: Props) {
  const { meta, kind } = field;
  const label = (
    <span>
      {meta.name}
      {meta.required && <span className={css.req}> *</span>}
    </span>
  );
  const options = useMemo(() => allowedOptions(meta.allowedValues), [meta.allowedValues]);
  const suggestLabels = useMemo(() => labelSearcher(issueId), [issueId]);
  const pickIssues = useMemo(() => issueSearcher(projectKey ? `project = ${projectKey}` : undefined), [projectKey]);
  const labelFor = useMemo(() => rawLabels(raw), [raw]);
  const str = typeof value === "string" ? value : "";
  const list = listValue(value);
  const single = str ? [str] : [];
  const setSingle = (ids: string[]) => onChange(ids[0] ?? "");

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
        <div className={css.fld}>
          {label}
          <Picker value={single} onChange={setSingle} options={options} placeholder={allowEmpty ? "Default" : meta.required ? "Search…" : "None"} />
        </div>
      );
    case "multiselect":
      return (
        <div className={css.fld}>
          {label}
          <Picker value={list} onChange={onChange} multiple options={options} placeholder="Search…" />
        </div>
      );
    case "strings":
      return (
        <div className={css.fld}>
          {label}
          <Picker value={list} onChange={onChange} multiple allowCustom placeholder="Type and press Enter" />
        </div>
      );
    case "labels":
      return (
        <div className={css.fld}>
          {label}
          <Picker value={list} onChange={onChange} multiple allowCustom normalize={normalizeLabel} search={suggestLabels} minChars={0} placeholder="Search labels…" />
        </div>
      );
    case "user":
    case "users": {
      const multi = kind === "users";
      const me_ = me && (
        <button
          type="button"
          className={`ghost ${css.small}`}
          onClick={() => (multi ? onChange(list.includes(me.name) ? list : [...list, me.name]) : onChange(me.name))}
        >
          Me
        </button>
      );
      return (
        <div className={css.fld}>
          {label}
          <Picker
            value={multi ? list : single}
            onChange={multi ? onChange : setSingle}
            multiple={multi}
            search={searchUsers}
            minChars={2}
            allowCustom
            placeholder={multi ? "Search users…" : "Search user…"}
            actions={me_}
            labelFor={labelFor}
          />
        </div>
      );
    }
    case "group":
    case "groups": {
      const multi = kind === "groups";
      return (
        <div className={css.fld}>
          {label}
          <Picker
            value={multi ? list : single}
            onChange={multi ? onChange : setSingle}
            multiple={multi}
            search={searchGroups}
            minChars={0}
            allowCustom
            placeholder={multi ? "Search groups…" : "Search group…"}
            labelFor={labelFor}
          />
        </div>
      );
    }
    case "issue":
      return (
        <div className={css.fld}>
          {label}
          <Picker value={single} onChange={setSingle} search={pickIssues} minChars={1} allowCustom placeholder="Key or summary…" />
        </div>
      );
    case "cascading": {
      const c = (typeof value === "object" && !Array.isArray(value) && "parent" in value ? value : { parent: "", child: "" }) as Cascading;
      const children = allowedOptions(childOptions(meta, c.parent));
      return (
        <div className={css.fld}>
          {label}
          <Picker value={c.parent ? [c.parent] : []} onChange={(ids) => onChange({ parent: ids[0] ?? "", child: "" })} options={options} placeholder="None" />
          {children.length > 0 && (
            <Picker value={c.child ? [c.child] : []} onChange={(ids) => onChange({ parent: c.parent, child: ids[0] ?? "" })} options={children} placeholder="None" />
          )}
        </div>
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
