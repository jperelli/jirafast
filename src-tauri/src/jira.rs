//! Thin async client for the Jira Server / Data Center REST API v2
//! (tested against Jira 10.3.x). Only the endpoints the UI needs.

use base64::Engine;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Auth {
    /// Personal Access Token (Jira 8.14+). Sent as `Authorization: Bearer`.
    Pat { token: String },
    /// Username + password (or username + PAT on instances that accept it).
    Basic { username: String, password: String },
}

impl Auth {
    fn header_value(&self) -> HeaderValue {
        let s = match self {
            Auth::Pat { token } => format!("Bearer {token}"),
            Auth::Basic { username, password } => {
                let raw = format!("{username}:{password}");
                format!(
                    "Basic {}",
                    base64::engine::general_purpose::STANDARD.encode(raw)
                )
            }
        };
        let mut v = HeaderValue::from_str(&s).unwrap_or_else(|_| HeaderValue::from_static(""));
        v.set_sensitive(true);
        v
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JiraError {
    #[error("invalid Jira URL: {0}")]
    InvalidUrl(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("Jira returned HTTP {status}: {message}")]
    Http { status: u16, message: String },
    #[error("unexpected response: {0}")]
    Decode(String),
    #[error("not connected to a Jira instance")]
    NotConnected,
    #[error("storage error: {0}")]
    Io(String),
}

impl From<std::io::Error> for JiraError {
    fn from(e: std::io::Error) -> Self {
        JiraError::Io(e.to_string())
    }
}

impl From<reqwest::Error> for JiraError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_decode() {
            JiraError::Decode(e.to_string())
        } else {
            JiraError::Network(e.without_url().to_string())
        }
    }
}

impl Serialize for JiraError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, JiraError>;

#[derive(Debug, Clone)]
pub struct JiraClient {
    http: reqwest::Client,
    /// Base URL of the Jira instance including context path, no trailing slash.
    base_url: String,
    /// `scheme://host[:port]` of the base URL, used to resolve absolute paths
    /// that Jira puts in rendered HTML (`/jira/secure/attachment/...`).
    origin: String,
}

pub struct Asset {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

impl JiraClient {
    pub fn new(base_url: &str, auth: &Auth, accept_invalid_certs: bool) -> Result<Self> {
        let base_url = normalize_base_url(base_url)?;
        let parsed =
            url::Url::parse(&base_url).map_err(|e| JiraError::InvalidUrl(e.to_string()))?;
        let origin = parsed.origin().ascii_serialization();

        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, auth.header_value());
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        // Disables Jira's XSRF check for non-browser clients on POST/PUT/DELETE.
        headers.insert("X-Atlassian-Token", HeaderValue::from_static("no-check"));

        let http = reqwest::Client::builder()
            .default_headers(headers)
            .user_agent(concat!("jirafast/", env!("CARGO_PKG_VERSION")))
            .gzip(true)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(8)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .danger_accept_invalid_certs(accept_invalid_certs)
            .build()?;

        Ok(Self {
            http,
            base_url,
            origin,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn api(&self, path: &str) -> String {
        format!(
            "{}/rest/api/2/{}",
            self.base_url,
            path.trim_start_matches('/')
        )
    }

    async fn send_json(&self, method: Method, url: String, body: Option<&Value>) -> Result<Value> {
        let mut req = self.http.request(method, &url);
        if let Some(b) = body {
            req = req.header(CONTENT_TYPE, "application/json").json(b);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if status == StatusCode::NO_CONTENT {
            return Ok(Value::Null);
        }
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(JiraError::Http {
                status: status.as_u16(),
                message: extract_error_message(&text, status),
            });
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        serde_json::from_str(&text).map_err(|e| JiraError::Decode(e.to_string()))
    }

    async fn get(&self, url: String) -> Result<Value> {
        self.send_json(Method::GET, url, None).await
    }

    async fn post(&self, url: String, body: &Value) -> Result<Value> {
        self.send_json(Method::POST, url, Some(body)).await
    }

    async fn put(&self, url: String, body: &Value) -> Result<Value> {
        self.send_json(Method::PUT, url, Some(body)).await
    }

    // ---- endpoints -------------------------------------------------------

    pub async fn myself(&self) -> Result<Value> {
        self.get(self.api("myself")).await
    }

    pub async fn server_info(&self) -> Result<Value> {
        self.get(self.api("serverInfo")).await
    }

    pub async fn search(
        &self,
        jql: &str,
        start_at: u32,
        max_results: u32,
        fields: &[&str],
    ) -> Result<Value> {
        let body = serde_json::json!({
            "jql": jql,
            "startAt": start_at,
            "maxResults": max_results,
            "fields": fields,
        });
        self.post(self.api("search"), &body).await
    }

    /// Full issue including server-rendered HTML for description and comments.
    pub async fn issue(&self, key: &str) -> Result<Value> {
        let url = format!(
            "{}?expand=renderedFields,transitions&fields=*all",
            self.api(&format!("issue/{}", key))
        );
        self.get(url).await
    }

    pub async fn add_comment(&self, key: &str, body: &str) -> Result<Value> {
        let url = format!(
            "{}?expand=renderedBody",
            self.api(&format!("issue/{}/comment", key))
        );
        self.post(url, &serde_json::json!({ "body": body })).await
    }

    pub async fn transitions(&self, key: &str) -> Result<Value> {
        self.get(self.api(&format!("issue/{}/transitions", key)))
            .await
    }

    pub async fn do_transition(
        &self,
        key: &str,
        transition_id: &str,
        comment: Option<&str>,
    ) -> Result<Value> {
        let mut body = serde_json::json!({ "transition": { "id": transition_id } });
        if let Some(c) = comment.filter(|c| !c.trim().is_empty()) {
            body["update"] = serde_json::json!({ "comment": [{ "add": { "body": c } }] });
        }
        self.post(self.api(&format!("issue/{}/transitions", key)), &body)
            .await
    }

    pub async fn assign(&self, key: &str, username: Option<&str>) -> Result<Value> {
        // `null` unassigns, `"-1"` uses the project default assignee.
        let body = serde_json::json!({ "name": username });
        self.put(self.api(&format!("issue/{}/assignee", key)), &body)
            .await
    }

    pub async fn favourite_filters(&self) -> Result<Value> {
        self.get(self.api("filter/favourite")).await
    }

    pub async fn projects(&self) -> Result<Value> {
        self.get(self.api("project")).await
    }

    pub async fn user_search(&self, query: &str) -> Result<Value> {
        let url = format!(
            "{}?username={}&maxResults=20",
            self.api("user/search"),
            urlencode(query)
        );
        self.get(url).await
    }

    /// Fetch a binary asset (attachment, thumbnail, avatar, icon) referenced
    /// from rendered HTML. `path` is host-absolute (`/jira/secure/...`) and may
    /// include a query string.
    pub async fn fetch_asset(&self, path_and_query: &str) -> Result<Asset> {
        let url = if path_and_query.starts_with("http://") || path_and_query.starts_with("https://")
        {
            path_and_query.to_string()
        } else {
            format!("{}/{}", self.origin, path_and_query.trim_start_matches('/'))
        };
        let resp = self.http.get(&url).header(ACCEPT, "*/*").send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(JiraError::Http {
                status: status.as_u16(),
                message: format!("asset {path_and_query}"),
            });
        }
        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();
        let bytes = resp.bytes().await?.to_vec();
        Ok(Asset {
            content_type,
            bytes,
        })
    }
}

fn normalize_base_url(input: &str) -> Result<String> {
    let mut s = input.trim().trim_end_matches('/').to_string();
    if s.is_empty() {
        return Err(JiraError::InvalidUrl("empty".into()));
    }
    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }
    let parsed = url::Url::parse(&s).map_err(|e| JiraError::InvalidUrl(e.to_string()))?;
    if parsed.host_str().is_none() {
        return Err(JiraError::InvalidUrl("missing host".into()));
    }
    Ok(s)
}

fn extract_error_message(text: &str, status: StatusCode) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        let mut parts: Vec<String> = Vec::new();
        if let Some(arr) = v.get("errorMessages").and_then(Value::as_array) {
            parts.extend(arr.iter().filter_map(Value::as_str).map(String::from));
        }
        if let Some(obj) = v.get("errors").and_then(Value::as_object) {
            parts.extend(
                obj.iter()
                    .map(|(k, v)| format!("{k}: {}", v.as_str().unwrap_or(""))),
            );
        }
        if let Some(m) = v.get("message").and_then(Value::as_str) {
            parts.push(m.to_string());
        }
        if !parts.is_empty() {
            return parts.join("; ");
        }
    }
    match status {
        StatusCode::UNAUTHORIZED => "authentication failed (check token / password)".into(),
        StatusCode::FORBIDDEN => "forbidden (Jira may require a CAPTCHA after failed logins, or the token lacks permission)".into(),
        StatusCode::NOT_FOUND => "not found (check the base URL includes the context path, e.g. https://host/jira)".into(),
        _ => status.canonical_reason().unwrap_or("error").to_string(),
    }
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_urls() {
        assert_eq!(
            normalize_base_url("jira.example.com/").unwrap(),
            "https://jira.example.com"
        );
        assert_eq!(
            normalize_base_url("http://host:8080/jira/").unwrap(),
            "http://host:8080/jira"
        );
        assert!(normalize_base_url("").is_err());
    }

    #[test]
    fn extracts_error_messages() {
        let msg = extract_error_message(
            r#"{"errorMessages":["Issue Does Not Exist"],"errors":{}}"#,
            StatusCode::NOT_FOUND,
        );
        assert_eq!(msg, "Issue Does Not Exist");
        let msg = extract_error_message("", StatusCode::UNAUTHORIZED);
        assert!(msg.contains("authentication failed"));
    }

    #[test]
    fn origin_from_context_path() {
        let c = JiraClient::new(
            "https://jira.example.com/jira",
            &Auth::Pat { token: "x".into() },
            false,
        )
        .unwrap();
        assert_eq!(c.origin, "https://jira.example.com");
        assert_eq!(
            c.api("myself"),
            "https://jira.example.com/jira/rest/api/2/myself"
        );
    }
}
