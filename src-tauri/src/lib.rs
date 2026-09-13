mod cache;
mod jira;
mod settings;

use cache::Cache;
use jira::{JiraClient, JiraError, Result};
use serde::Serialize;
use serde_json::Value;
use settings::{PublicSettings, Settings};
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::http::{header, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, State};

/// Fields requested for list views. Everything else is loaded per issue.
const LIST_FIELDS: &[&str] = &[
    "summary",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "reporter",
    "updated",
    "created",
    "project",
    "labels",
    "duedate",
    "resolution",
];

pub struct AppState {
    config_dir: PathBuf,
    settings: RwLock<Option<Settings>>,
    client: RwLock<Option<Arc<JiraClient>>>,
    cache: Cache,
    prefetch_sem: Arc<tokio::sync::Semaphore>,
}

impl AppState {
    fn client(&self) -> Result<Arc<JiraClient>> {
        self.client
            .read()
            .ok()
            .and_then(|c| c.clone())
            .ok_or(JiraError::NotConnected)
    }

    fn set_connection(&self, settings: Settings, client: Arc<JiraClient>) {
        if let Ok(mut c) = self.client.write() {
            *c = Some(client);
        }
        if let Ok(mut s) = self.settings.write() {
            *s = Some(settings);
        }
    }
}

#[derive(Serialize)]
pub struct CachedResponse {
    value: Value,
    fetched_at: u64,
    from_cache: bool,
}

impl CachedResponse {
    fn from_cache(c: cache::Cached) -> Self {
        Self {
            value: c.value,
            fetched_at: c.fetched_at,
            from_cache: true,
        }
    }
    fn fresh(c: cache::Cached) -> Self {
        Self {
            value: c.value,
            fetched_at: c.fetched_at,
            from_cache: false,
        }
    }
}

/// Stale-while-revalidate building block: with `prefer_cache` the command
/// answers instantly from cache (or `None`); otherwise it fetches, stores and
/// returns the fresh value. The frontend calls both back to back.
async fn cached_or_fetch<F>(
    state: &AppState,
    key: &str,
    prefer_cache: bool,
    fetch: F,
) -> Result<Option<CachedResponse>>
where
    F: std::future::Future<Output = Result<Value>>,
{
    if prefer_cache {
        return Ok(state.cache.get(key).map(CachedResponse::from_cache));
    }
    let value = fetch.await?;
    Ok(Some(CachedResponse::fresh(state.cache.put(key, value))))
}

fn issue_cache_key(key: &str) -> String {
    format!("issue:{}", key.to_uppercase())
}

// ---- commands ------------------------------------------------------------

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Option<PublicSettings> {
    state
        .settings
        .read()
        .ok()?
        .as_ref()
        .map(PublicSettings::from)
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, settings: Settings) -> Result<Value> {
    let client = Arc::new(JiraClient::new(
        &settings.base_url,
        &settings.auth,
        settings.accept_invalid_certs,
    )?);
    let me = client.myself().await?;
    let settings = Settings {
        base_url: client.base_url().to_string(),
        ..settings
    };
    settings::save(&state.config_dir, &settings)?;
    state.set_connection(settings, client);
    Ok(me)
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> Result<()> {
    if let Ok(mut c) = state.client.write() {
        *c = None;
    }
    if let Ok(mut s) = state.settings.write() {
        *s = None;
    }
    settings::delete(&state.config_dir)?;
    state.cache.clear();
    Ok(())
}

#[tauri::command]
async fn get_myself(state: State<'_, AppState>) -> Result<Value> {
    state.client()?.myself().await
}

#[tauri::command]
async fn get_server_info(state: State<'_, AppState>) -> Result<Value> {
    state.client()?.server_info().await
}

#[tauri::command]
async fn search_issues(
    state: State<'_, AppState>,
    jql: String,
    start_at: u32,
    max_results: u32,
    prefer_cache: bool,
) -> Result<Option<CachedResponse>> {
    let key = format!("search:{start_at}:{max_results}:{}", jql.trim());
    let client = state.client()?;
    cached_or_fetch(&state, &key, prefer_cache, async {
        client
            .search(jql.trim(), start_at, max_results.min(200), LIST_FIELDS)
            .await
    })
    .await
}

#[tauri::command]
async fn get_issue(
    state: State<'_, AppState>,
    key: String,
    prefer_cache: bool,
) -> Result<Option<CachedResponse>> {
    let client = state.client()?;
    let ck = issue_cache_key(&key);
    cached_or_fetch(&state, &ck, prefer_cache, async {
        client.issue(key.trim()).await
    })
    .await
}

/// Warm the cache for issues the user is likely to open next. Emits
/// `issue-cached` with the key once each one lands.
#[tauri::command]
async fn prefetch_issues(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: Vec<String>,
    max_age_secs: u64,
) -> Result<()> {
    let client = state.client()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    for key in keys.into_iter().take(50) {
        let ck = issue_cache_key(&key);
        if let Some(c) = state.cache.get(&ck) {
            if now.saturating_sub(c.fetched_at) < max_age_secs {
                continue;
            }
        }
        let client = client.clone();
        let sem = state.prefetch_sem.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(_permit) = sem.acquire().await else {
                return;
            };
            match client.issue(&key).await {
                Ok(v) => {
                    let st = app.state::<AppState>();
                    st.cache.put(&ck, v);
                    let _ = app.emit("issue-cached", &key);
                }
                Err(e) => log::debug!("prefetch {key} failed: {e}"),
            }
        });
    }
    Ok(())
}

#[tauri::command]
async fn add_comment(state: State<'_, AppState>, key: String, body: String) -> Result<Value> {
    let client = state.client()?;
    let res = client.add_comment(&key, &body).await?;
    refresh_issue(&state, &client, &key).await;
    Ok(res)
}

#[tauri::command]
async fn get_transitions(state: State<'_, AppState>, key: String) -> Result<Value> {
    state.client()?.transitions(&key).await
}

#[tauri::command]
async fn do_transition(
    state: State<'_, AppState>,
    key: String,
    transition_id: String,
    comment: Option<String>,
) -> Result<Value> {
    let client = state.client()?;
    client
        .do_transition(&key, &transition_id, comment.as_deref())
        .await?;
    Ok(refresh_issue(&state, &client, &key)
        .await
        .unwrap_or(Value::Null))
}

#[tauri::command]
async fn assign_issue(
    state: State<'_, AppState>,
    key: String,
    username: Option<String>,
) -> Result<Value> {
    let client = state.client()?;
    client.assign(&key, username.as_deref()).await?;
    Ok(refresh_issue(&state, &client, &key)
        .await
        .unwrap_or(Value::Null))
}

async fn refresh_issue(state: &AppState, client: &JiraClient, key: &str) -> Option<Value> {
    match client.issue(key).await {
        Ok(v) => {
            state.cache.put(&issue_cache_key(key), v.clone());
            Some(v)
        }
        Err(e) => {
            log::warn!("refresh {key} after write failed: {e}");
            None
        }
    }
}

#[tauri::command]
async fn get_favourite_filters(
    state: State<'_, AppState>,
    prefer_cache: bool,
) -> Result<Option<CachedResponse>> {
    let client = state.client()?;
    cached_or_fetch(&state, "filters:favourite", prefer_cache, async {
        client.favourite_filters().await
    })
    .await
}

#[tauri::command]
async fn get_projects(
    state: State<'_, AppState>,
    prefer_cache: bool,
) -> Result<Option<CachedResponse>> {
    let client = state.client()?;
    cached_or_fetch(&state, "projects", prefer_cache, async {
        client.projects().await
    })
    .await
}

#[tauri::command]
async fn search_users(state: State<'_, AppState>, query: String) -> Result<Value> {
    state.client()?.user_search(&query).await
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>) -> Result<()> {
    state.cache.clear();
    Ok(())
}

// ---- jira-asset:// protocol ----------------------------------------------

/// Serves attachments, thumbnails, avatars and icons referenced by Jira's
/// rendered HTML through the authenticated client, with an on-disk cache.
/// The webview loads `jira-asset://localhost/<jira path>` (Linux/macOS) or
/// `http://jira-asset.localhost/<jira path>` (Windows).
fn asset_protocol(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let path = request.uri().path().to_string();
    let path_and_query = match request.uri().query() {
        Some(q) => format!("{path}?{q}"),
        None => path,
    };
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let respond = |status: StatusCode, content_type: &str, body: Vec<u8>| {
            let resp = Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                .body(body)
                .unwrap_or_else(|_| Response::new(Vec::new()));
            responder.respond(resp);
        };
        if let Some((ct, bytes)) = state.cache.get_asset(&path_and_query) {
            respond(StatusCode::OK, &ct, bytes);
            return;
        }
        let Ok(client) = state.client() else {
            respond(
                StatusCode::UNAUTHORIZED,
                "text/plain",
                b"not connected".to_vec(),
            );
            return;
        };
        match client.fetch_asset(&path_and_query).await {
            Ok(asset) => {
                state
                    .cache
                    .put_asset(&path_and_query, &asset.content_type, &asset.bytes);
                respond(StatusCode::OK, &asset.content_type, asset.bytes);
            }
            Err(e) => {
                log::debug!("asset {path_and_query}: {e}");
                let status = match e {
                    JiraError::Http { status, .. } => {
                        StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY)
                    }
                    _ => StatusCode::BAD_GATEWAY,
                };
                respond(status, "text/plain", e.to_string().into_bytes());
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("jirafast=info"),
    )
    .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?.join("v1");
            let settings = settings::load(&config_dir);
            let client = settings
                .as_ref()
                .and_then(|s| JiraClient::new(&s.base_url, &s.auth, s.accept_invalid_certs).ok())
                .map(Arc::new);
            app.manage(AppState {
                config_dir,
                settings: RwLock::new(settings),
                client: RwLock::new(client),
                cache: Cache::new(cache_dir),
                prefetch_sem: Arc::new(tokio::sync::Semaphore::new(4)),
            });
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("jira-asset", asset_protocol)
        .invoke_handler(tauri::generate_handler![
            get_settings,
            connect,
            disconnect,
            get_myself,
            get_server_info,
            search_issues,
            get_issue,
            prefetch_issues,
            add_comment,
            get_transitions,
            do_transition,
            assign_issue,
            get_favourite_filters,
            get_projects,
            search_users,
            clear_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
