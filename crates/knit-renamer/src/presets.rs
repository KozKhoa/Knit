use std::fs;
use std::io::Write;
use std::path::PathBuf;

use knit_core::{app_config_dir, atomic_write_file, KnitError, Result};
use uuid::Uuid;

use crate::models::{RenameRule, UserPreset};

pub struct PresetStore {
    path: PathBuf,
}

impl PresetStore {
    pub fn default_os() -> Self {
        Self {
            path: app_config_dir().join("renamer_presets.json"),
        }
    }

    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<Vec<UserPreset>> {
        if !self.path.is_file() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(&self.path)?;
        let list = serde_json::from_slice(&bytes)
            .map_err(|e| KnitError::InvalidInput(format!("Lỗi đọc presets JSON: {e}")))?;
        Ok(list)
    }

    pub fn save_preset(
        &self,
        id: Option<String>,
        title: String,
        description: String,
        rule: RenameRule,
    ) -> Result<UserPreset> {
        let mut presets = self.load().unwrap_or_default();
        let target_id = id.unwrap_or_else(|| format!("custom_{}", Uuid::new_v4().simple()));
        let item = UserPreset {
            id: target_id.clone(),
            title: title.trim().to_string(),
            description: description.trim().to_string(),
            rule,
        };
        if let Some(existing) = presets.iter_mut().find(|p| p.id == target_id) {
            *existing = item.clone();
        } else {
            presets.push(item.clone());
        }
        self.write_all(&presets)?;
        Ok(item)
    }

    pub fn delete_preset(&self, id: &str) -> Result<bool> {
        let mut presets = self.load().unwrap_or_default();
        let before = presets.len();
        presets.retain(|p| p.id != id);
        if presets.len() != before {
            self.write_all(&presets)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn write_all(&self, presets: &[UserPreset]) -> Result<()> {
        let bytes =
            serde_json::to_vec_pretty(presets).map_err(|e| KnitError::Internal(e.to_string()))?;
        atomic_write_file(&self.path, |f| {
            f.write_all(&bytes)?;
            Ok(())
        })
    }
}
