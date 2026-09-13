import { useEffect, useRef, useState, type FormEvent } from "react";
import { app, useApp } from "../lib/store";
import { errorMessage } from "../lib/api";
import type { SettingsInput } from "../lib/types";
import css from "./Connect.module.css";

export default function Connect() {
  const settings = useApp((s) => s.settings);
  const [baseUrl, setBaseUrl] = useState(settings?.base_url ?? "");
  const [kind, setKind] = useState<"pat" | "basic">(settings?.auth_kind ?? "pat");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState(settings?.username ?? "");
  const [password, setPassword] = useState("");
  const [acceptInvalidCerts, setAcceptInvalidCerts] = useState(settings?.accept_invalid_certs ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  useEffect(() => urlInput.current?.focus(), []);

  const canSubmit =
    baseUrl.trim().length > 0 && (kind === "pat" ? token.trim().length > 0 : username.trim().length > 0 && password.length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    const input: SettingsInput = {
      base_url: baseUrl.trim(),
      auth: kind === "pat" ? { kind: "pat", token: token.trim() } : { kind: "basic", username: username.trim(), password },
      accept_invalid_certs: acceptInvalidCerts,
    };
    try {
      await app.connect(input);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={css.wrap}>
      <form className={css.card} onSubmit={submit}>
        <h1>jirafast</h1>
        <p className="muted">Connect to your Jira Server / Data Center instance (tested with Jira 10.3).</p>

        <label>
          <span>Jira URL</span>
          <input
            type="url"
            ref={urlInput}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://jira.example.com  or  https://host/jira"
            autoComplete="url"
            required
          />
          <small className="muted">
            Include the context path if your Jira lives under one (e.g. <code>/jira</code>).
          </small>
        </label>

        <div className={css.tabs} role="tablist">
          <button type="button" className={kind === "pat" ? css.active : ""} onClick={() => setKind("pat")}>
            Personal Access Token
          </button>
          <button type="button" className={kind === "basic" ? css.active : ""} onClick={() => setKind("basic")}>
            Username &amp; password
          </button>
        </div>

        {kind === "pat" ? (
          <label>
            <span>Personal Access Token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
            <small className="muted">
              Create one in Jira under <em>Profile → Personal Access Tokens</em>. Recommended.
            </small>
          </label>
        ) : (
          <>
            <label>
              <span>Username</span>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          </>
        )}

        <label className={css.row}>
          <input type="checkbox" checked={acceptInvalidCerts} onChange={(e) => setAcceptInvalidCerts(e.target.checked)} />
          <span>Accept self-signed / invalid TLS certificates</span>
        </label>

        {error && <div className={css.error}>{error}</div>}

        <button className={`primary ${css.submit}`} type="submit" disabled={!canSubmit || busy}>
          {busy ? (
            <>
              <span className="spin"></span> Connecting…
            </>
          ) : (
            "Connect"
          )}
        </button>
        <small className="muted">
          Credentials are stored locally in the app config directory (user-readable only) and only ever sent to the URL above.
        </small>
      </form>
    </div>
  );
}
