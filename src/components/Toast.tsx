import { useApp } from "../lib/store";
import css from "./Toast.module.css";

export default function Toast() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`${css.toast} ${toast.kind === "error" ? css.error : ""}`} role="status">
      {toast.text}
    </div>
  );
}
