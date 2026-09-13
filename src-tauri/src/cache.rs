//! Two-level (memory + disk) cache so that anything the user has seen once
//! renders instantly the next time, while a fresh copy is fetched behind it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cached {
    pub fetched_at: u64,
    pub value: Value,
}

pub struct Cache {
    dir: PathBuf,
    mem: Mutex<HashMap<String, Cached>>,
    max_mem_entries: usize,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn key_hash(key: &str) -> String {
    let mut h = DefaultHasher::new();
    key.hash(&mut h);
    format!("{:016x}", h.finish())
}

impl Cache {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(dir.join("json"));
        let _ = std::fs::create_dir_all(dir.join("assets"));
        Self {
            dir,
            mem: Mutex::new(HashMap::new()),
            max_mem_entries: 2000,
        }
    }

    fn json_path(&self, key: &str) -> PathBuf {
        self.dir
            .join("json")
            .join(format!("{}.json", key_hash(key)))
    }

    pub fn get(&self, key: &str) -> Option<Cached> {
        if let Some(c) = self.mem.lock().ok()?.get(key) {
            return Some(c.clone());
        }
        let raw = std::fs::read(self.json_path(key)).ok()?;
        let c: Cached = serde_json::from_slice(&raw).ok()?;
        if let Ok(mut m) = self.mem.lock() {
            m.insert(key.to_string(), c.clone());
        }
        Some(c)
    }

    pub fn put(&self, key: &str, value: Value) -> Cached {
        let c = Cached {
            fetched_at: now(),
            value,
        };
        if let Ok(mut m) = self.mem.lock() {
            if m.len() >= self.max_mem_entries {
                // Cheap eviction: drop the oldest half by fetched_at.
                let mut entries: Vec<(String, u64)> =
                    m.iter().map(|(k, v)| (k.clone(), v.fetched_at)).collect();
                entries.sort_by_key(|(_, t)| *t);
                for (k, _) in entries.into_iter().take(self.max_mem_entries / 2) {
                    m.remove(&k);
                }
            }
            m.insert(key.to_string(), c.clone());
        }
        if let Ok(data) = serde_json::to_vec(&c) {
            let path = self.json_path(key);
            let tmp = path.with_extension("tmp");
            if std::fs::write(&tmp, data).is_ok() {
                let _ = std::fs::rename(tmp, path);
            }
        }
        c
    }

    // ---- binary assets (attachments, avatars) ----------------------------

    fn asset_paths(&self, key: &str) -> (PathBuf, PathBuf) {
        let base = self.dir.join("assets").join(key_hash(key));
        (base.with_extension("bin"), base.with_extension("type"))
    }

    pub fn get_asset(&self, key: &str) -> Option<(String, Vec<u8>)> {
        let (bin, ty) = self.asset_paths(key);
        let bytes = std::fs::read(bin).ok()?;
        let content_type =
            std::fs::read_to_string(ty).unwrap_or_else(|_| "application/octet-stream".into());
        Some((content_type, bytes))
    }

    pub fn put_asset(&self, key: &str, content_type: &str, bytes: &[u8]) {
        let (bin, ty) = self.asset_paths(key);
        let _ = std::fs::write(ty, content_type);
        let tmp = bin.with_extension("tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(tmp, bin);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut m) = self.mem.lock() {
            m.clear();
        }
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = std::fs::create_dir_all(self.dir.join("json"));
        let _ = std::fs::create_dir_all(self.dir.join("assets"));
    }
}
