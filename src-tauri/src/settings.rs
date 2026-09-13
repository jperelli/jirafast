use crate::jira::Auth;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub base_url: String,
    pub auth: Auth,
    #[serde(default)]
    pub accept_invalid_certs: bool,
}

/// What the frontend is allowed to see: never the secret itself.
#[derive(Debug, Clone, Serialize)]
pub struct PublicSettings {
    pub base_url: String,
    pub auth_kind: &'static str,
    pub username: Option<String>,
    pub accept_invalid_certs: bool,
}

impl From<&Settings> for PublicSettings {
    fn from(s: &Settings) -> Self {
        let (auth_kind, username) = match &s.auth {
            Auth::Pat { .. } => ("pat", None),
            Auth::Basic { username, .. } => ("basic", Some(username.clone())),
        };
        PublicSettings {
            base_url: s.base_url.clone(),
            auth_kind,
            username,
            accept_invalid_certs: s.accept_invalid_certs,
        }
    }
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join("settings.json")
}

pub fn load(config_dir: &Path) -> Option<Settings> {
    let raw = std::fs::read(settings_path(config_dir)).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub fn save(config_dir: &Path, settings: &Settings) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    let path = settings_path(config_dir);
    let data = serde_json::to_vec_pretty(settings).map_err(std::io::Error::other)?;
    write_private(&path, &data)
}

pub fn delete(config_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(settings_path(config_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Write a file readable only by the current user (on Unix); the credentials
/// live in here.
fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        std::io::Write::write_all(&mut f, data)?;
        f.sync_all()?;
    }
    std::fs::rename(tmp, path)
}
