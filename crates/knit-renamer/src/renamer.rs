use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use knit_core::{atomic_write_file, JobReporter, JobReporterExt, KnitError, Result};
use uuid::Uuid;

use crate::models::{
    RenameExecutionResult, RenamePlan, RenameStatus, UndoEntry, UndoManifest,
};

pub fn apply_rename_plan(
    plan: &mut RenamePlan,
    undo_path: Option<&PathBuf>,
    reporter: &dyn JobReporter,
) -> Result<RenameExecutionResult> {
    if plan.conflict_count() > 0 {
        return Err(KnitError::InvalidInput(format!(
            "Còn {} xung đột tên chưa xử lý",
            plan.conflict_count()
        )));
    }

    let mut renamed_count = 0usize;
    let mut skipped_count = 0usize;
    let mut error_count = 0usize;
    let mut undo_entries = Vec::new();

    for item in &mut plan.items {
        if !item.selected || item.status != RenameStatus::Pending {
            skipped_count += 1;
            continue;
        }

        let res = rename_with_case_safety(&item.original_path, &item.new_path);
        match res {
            Ok(()) => {
                item.status = RenameStatus::Renamed;
                renamed_count += 1;
                reporter.info(format!("Đổi tên: {} -> {}", item.original_name, item.new_name));
                undo_entries.push(UndoEntry {
                    original_path: item.original_path.clone(),
                    new_path: item.new_path.clone(),
                    is_dir: item.is_dir,
                });
            }
            Err(e) => {
                item.status = RenameStatus::Error;
                item.error_message = Some(e.to_string());
                error_count += 1;
                reporter.error(format!("Lỗi đổi tên {}: {e}", item.original_name));
            }
        }
    }

    let undo_available = !undo_entries.is_empty();
    if undo_available {
        if let Some(manifest_path) = undo_path {
            let manifest = UndoManifest {
                timestamp: Utc::now().to_rfc3339(),
                entries: undo_entries,
            };
            let json = serde_json::to_vec_pretty(&manifest)
                .map_err(|e| KnitError::Internal(e.to_string()))?;
            atomic_write_file(manifest_path, |f| {
                use std::io::Write;
                f.write_all(&json)?;
                Ok(())
            })?;
        }
    }

    Ok(RenameExecutionResult {
        renamed_count,
        skipped_count,
        error_count,
        undo_available,
    })
}

/// Xử lý đổi hoa-thường cùng tên an toàn trên cả Windows NTFS/exFAT lẫn Linux.
fn rename_with_case_safety(from: &PathBuf, to: &PathBuf) -> std::io::Result<()> {
    let same_casefold = from.to_string_lossy().eq_ignore_ascii_case(&to.to_string_lossy());
    if same_casefold && from != to {
        let tmp = from.with_file_name(format!(".knit_rename_tmp_{}", Uuid::new_v4().simple()));
        fs::rename(from, &tmp)?;
        if let Err(e) = fs::rename(&tmp, to) {
            let _ = fs::rename(&tmp, from);
            return Err(e);
        }
        Ok(())
    } else {
        fs::rename(from, to)
    }
}

pub fn undo_manifest(manifest_path: &PathBuf, reporter: &dyn JobReporter) -> Result<usize> {
    if !manifest_path.is_file() {
        return Err(KnitError::NotFound(
            "Không có lịch sử đổi tên nào để hoàn tác".to_string(),
        ));
    }

    let raw = fs::read(manifest_path)?;
    let manifest: UndoManifest =
        serde_json::from_slice(&raw).map_err(|e| KnitError::InvalidInput(e.to_string()))?;

    let mut restored = 0usize;
    // Hoàn tác theo thứ tự ngược lại (parent trước hoặc file sau cùng trước)
    for entry in manifest.entries.iter().rev() {
        if !entry.new_path.exists() {
            reporter.warn(format!("Bỏ qua hoàn tác (không tồn tại): {}", entry.new_path.display()));
            continue;
        }
        let same_casefold = entry
            .new_path
            .to_string_lossy()
            .eq_ignore_ascii_case(&entry.original_path.to_string_lossy());
        if !same_casefold && entry.original_path.exists() {
            reporter.warn(format!(
                "Bỏ qua hoàn tác (đích đã tồn tại): {}",
                entry.original_path.display()
            ));
            continue;
        }
        rename_with_case_safety(&entry.new_path, &entry.original_path)?;
        restored += 1;
        reporter.info(format!(
            "Hoàn tác: {} -> {}",
            entry.new_path.display(),
            entry.original_path.display()
        ));
    }

    let _ = fs::remove_file(manifest_path);
    Ok(restored)
}
