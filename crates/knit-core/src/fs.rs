use std::fs::{self, File};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use unicode_normalization::UnicodeNormalization;

use crate::{KnitError, Result};

/// Chuẩn hóa chuỗi Unicode về NFC (tránh lỗi NFD từ file macOS/USB).
pub fn nfc_normalize(input: &str) -> String {
    input.nfc().collect()
}

/// Định dạng dung lượng dễ đọc (KB, MB, GB).
pub fn human_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut val = bytes as f64;
    let mut idx = 0;
    while val >= 1024.0 && idx < UNITS.len() - 1 {
        val /= 1024.0;
        idx += 1;
    }
    if idx == 0 {
        format!("{bytes} B")
    } else {
        format!("{val:.1} {}", UNITS[idx])
    }
}

/// Loại bỏ ký tự không hợp lệ trên Windows/Linux/macOS và giới hạn độ dài tên file.
pub fn sanitize_filename(name: &str, max_len: usize) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();

    let trimmed = cleaned.trim();
    let truncated: String = trimmed.chars().take(max_len.max(1)).collect();
    // Windows không cho tên file kết thúc bằng dấu chấm hoặc khoảng trắng
    let safe = truncated.trim_end_matches([' ', '.']);
    if safe.is_empty() {
        "untitled".to_string()
    } else {
        safe.to_string()
    }
}

/// Nối đường dẫn tương đối vào `root` với kiểm tra chống path traversal (`../`) và đường dẫn tuyệt đối.
pub fn safe_join_within(root: &Path, rel: &str) -> Result<PathBuf> {
    let trimmed = rel.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || Path::new(trimmed).is_absolute()
    {
        return Err(KnitError::InvalidPath(rel.to_string()));
    }
    // Chặn Windows drive prefix ngay cả khi chạy trên Linux (ví dụ "C:foo" hoặc "C:/foo")
    if trimmed.as_bytes().get(1) == Some(&b':')
        && trimmed.as_bytes().first().is_some_and(|b| b.is_ascii_alphabetic())
    {
        return Err(KnitError::InvalidPath(rel.to_string()));
    }

    let normalized = trimmed.replace('\\', "/");
    let mut out = PathBuf::from(root);
    let mut depth = 0usize;

    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if depth == 0 {
                return Err(KnitError::InvalidPath(rel.to_string()));
            }
            depth -= 1;
            out.pop();
            continue;
        }
        let p = Path::new(seg);
        if matches!(p.components().next(), Some(Component::Prefix(_)) | Some(Component::RootDir)) {
            return Err(KnitError::InvalidPath(rel.to_string()));
        }
        out.push(seg);
        depth += 1;
    }
    Ok(out)
}

/// Kiểm tra dung lượng trống trên ổ đĩa chứa `dir` trước khi ghi file lớn.
pub fn ensure_disk_space(dir: &Path, needed_bytes: u64) -> Result<()> {
    if needed_bytes == 0 {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    let avail = fs4::available_space(dir)?;
    if avail < needed_bytes {
        return Err(KnitError::InsufficientDiskSpace {
            needed: human_size(needed_bytes),
            available: human_size(avail),
        });
    }
    Ok(())
}

/// Ghi file nguyên tử: ghi vào `<target>.tmp.<pid>`, flush, rồi replace sang `target`.
/// Nếu closure lỗi/hủy, file tạm tự động bị xóa.
pub fn atomic_write_file<F>(target: &Path, write_fn: F) -> Result<()>
where
    F: FnOnce(&mut File) -> Result<()>,
{
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let tmp_name = format!(
        ".{}.knit_tmp.{}",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("out"),
        std::process::id()
    );
    let tmp_path = target.with_file_name(tmp_name);

    let res = (|| -> Result<()> {
        let mut file = File::create(&tmp_path)?;
        write_fn(&mut file)?;
        file.flush()?;
        drop(file);
        if target.exists() {
            let _ = fs::remove_file(target);
        }
        fs::rename(&tmp_path, target)?;
        Ok(())
    })();

    if res.is_err() && tmp_path.exists() {
        let _ = fs::remove_file(&tmp_path);
    }
    res
}

/// Thư mục lưu cấu hình chuẩn OS (`%APPDATA%/knit` trên Windows, `~/.config/knit` trên Linux).
pub fn app_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("knit")
}

/// Thư mục cache chuẩn OS (`%LOCALAPPDATA%/knit` trên Windows, `~/.cache/knit` trên Linux).
pub fn app_cache_dir(sub: &str) -> PathBuf {
    let base = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("knit");
    if sub.is_empty() {
        base
    } else {
        base.join(sub)
    }
}
