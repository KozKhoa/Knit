//! Đóng gói file/thư mục sang ZIP (hỗ trợ AES-256 / ZipCrypto) và TAR / TAR.GZ / TAR.ZST.

use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use flate2::write::GzEncoder;
use flate2::Compression;
use knit_core::job::ThrottledReporter;
use knit_core::{
    ensure_disk_space, human_size, CancellationToken, JobProgress, JobReporter, JobReporterExt,
    KnitError, Result,
};
use serde::{Deserialize, Serialize};
use tar::Builder as TarBuilder;
use walkdir::WalkDir;
use zip::unstable::write::FileOptionsExt;
use zip::write::{FileOptions, SimpleFileOptions};
use zip::{AesMode, CompressionMethod, ZipWriter};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
    TarZst,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "password", rename_all = "snake_case")]
pub enum ZipEncryption {
    None,
    Aes256(String),
    ZipCrypto(String),
}

impl Default for ZipEncryption {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompressionLevel {
    Store,
    Fast,
    Normal,
    Best,
}

impl Default for CompressionLevel {
    fn default() -> Self {
        Self::Normal
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveOptions {
    pub format: ArchiveFormat,
    pub compression: CompressionLevel,
    pub encryption: ZipEncryption,
}

impl Default for ArchiveOptions {
    fn default() -> Self {
        Self {
            format: ArchiveFormat::Zip,
            compression: CompressionLevel::Normal,
            encryption: ZipEncryption::None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ArchiveEntrySpec {
    pub source_path: PathBuf,
    pub archive_path: String,
    pub size_bytes: u64,
    pub compression_override: Option<CompressionLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveSummary {
    pub output_path: PathBuf,
    pub files_packed: usize,
    pub input_bytes: u64,
    pub output_bytes: u64,
}

/// Gom danh sách file/thư mục đầu vào thành `ArchiveEntrySpec` với đường dẫn POSIX `/`.
pub fn collect_entries(
    inputs: &[PathBuf],
    include_root_dir: bool,
    ignore_hidden: bool,
) -> Result<Vec<ArchiveEntrySpec>> {
    if inputs.is_empty() {
        return Err(KnitError::InvalidInput(
            "Chưa chọn file hoặc thư mục nào để nén".to_string(),
        ));
    }

    let mut entries = Vec::new();
    for input in inputs {
        if !input.exists() {
            return Err(KnitError::NotFound(input.display().to_string()));
        }

        if input.is_file() {
            let name = input
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| KnitError::InvalidPath(input.display().to_string()))?;
            if ignore_hidden && name.starts_with('.') {
                continue;
            }
            let size = fs::metadata(input)?.len();
            entries.push(ArchiveEntrySpec {
                source_path: input.clone(),
                archive_path: name.to_string(),
                size_bytes: size,
                compression_override: None,
            });
            continue;
        }

        let root_name = input
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archive");

        let walker = WalkDir::new(input)
            .follow_links(false)
            .sort_by_file_name();

        for item in walker {
            let item = item.map_err(|e| KnitError::Internal(e.to_string()))?;
            if !item.file_type().is_file() {
                continue;
            }
            let rel = item
                .path()
                .strip_prefix(input)
                .map_err(|e| KnitError::Internal(e.to_string()))?;

            if ignore_hidden && has_hidden_component(rel) {
                continue;
            }

            let rel_posix = path_to_posix(rel);
            let arc_path = if include_root_dir {
                format!("{root_name}/{rel_posix}")
            } else {
                rel_posix
            };
            let size = item.metadata().map(|m| m.len()).unwrap_or(0);
            entries.push(ArchiveEntrySpec {
                source_path: item.path().to_path_buf(),
                archive_path: arc_path,
                size_bytes: size,
                compression_override: None,
            });
        }
    }

    if entries.is_empty() {
        return Err(KnitError::InvalidInput(
            "Không tìm thấy tệp hợp lệ nào để nén".to_string(),
        ));
    }
    Ok(entries)
}

fn has_hidden_component(rel: &Path) -> bool {
    rel.components().any(|c| {
        c.as_os_str()
            .to_str()
            .is_some_and(|s| s.starts_with('.'))
    })
}

fn path_to_posix(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/")
}

/// Đóng gói danh sách `entries` ra file `output_path` theo `AtomicOutput` + hỗ trợ hủy an toàn.
pub fn pack_entries(
    entries: &[ArchiveEntrySpec],
    output_path: &Path,
    options: &ArchiveOptions,
    token: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<ArchiveSummary> {
    if entries.is_empty() {
        return Err(KnitError::InvalidInput(
            "Danh sách tệp cần nén đang rỗng".to_string(),
        ));
    }
    if !matches!(options.format, ArchiveFormat::Zip)
        && !matches!(options.encryption, ZipEncryption::None)
    {
        return Err(KnitError::InvalidInput(
            "Chỉ định dạng ZIP mới hỗ trợ đặt mật khẩu".to_string(),
        ));
    }

    let out_dir = output_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let total_bytes: u64 = entries.iter().map(|e| e.size_bytes).sum();
    let needed = total_bytes.saturating_add(total_bytes / 50).saturating_add(1024 * 1024);
    ensure_disk_space(out_dir, needed)?;

    let throttled = ThrottledReporter::new(ForwardReporter(reporter), Duration::from_millis(100));
    reporter.info(format!(
        "Bắt đầu nén {} tệp ({}) -> {}",
        entries.len(),
        human_size(total_bytes),
        output_path.display()
    ));

    let tmp_path = output_path.with_file_name(format!(
        ".{}.knit_tmp.{}",
        output_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archive"),
        std::process::id()
    ));

    let res = match options.format {
        ArchiveFormat::Zip => write_zip(entries, &tmp_path, options, token, &throttled),
        ArchiveFormat::Tar | ArchiveFormat::TarGz | ArchiveFormat::TarZst => {
            write_tar(entries, &tmp_path, options, token, &throttled)
        }
    };

    if let Err(e) = res {
        if tmp_path.exists() {
            let _ = fs::remove_file(&tmp_path);
        }
        return Err(e);
    }

    if output_path.exists() {
        let _ = fs::remove_file(output_path);
    }
    fs::rename(&tmp_path, output_path)?;

    let output_bytes = fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
    reporter.info(format!(
        "Hoàn tất nén: {} ({})",
        output_path.display(),
        human_size(output_bytes)
    ));

    Ok(ArchiveSummary {
        output_path: output_path.to_path_buf(),
        files_packed: entries.len(),
        input_bytes: total_bytes,
        output_bytes,
    })
}

fn write_zip(
    entries: &[ArchiveEntrySpec],
    tmp_path: &Path,
    options: &ArchiveOptions,
    token: &CancellationToken,
    reporter: &ThrottledReporter<ForwardReporter<'_>>,
) -> Result<()> {
    let file = File::create(tmp_path)?;
    let mut writer = ZipWriter::new(BufWriter::new(file));

    let total_files = entries.len() as u64;
    let total_bytes: u64 = entries.iter().map(|e| e.size_bytes).sum();
    let mut done_bytes = 0u64;
    let mut buf = [0u8; 64 * 1024];

    for (idx, entry) in entries.iter().enumerate() {
        token.check()?;
        let level = entry.compression_override.unwrap_or(options.compression);
        let opts = build_zip_options(level, &options.encryption, entry.size_bytes)?;
        writer
            .start_file(&entry.archive_path, opts)
            .map_err(|e| KnitError::Internal(e.to_string()))?;

        let mut src = BufReader::new(File::open(&entry.source_path)?);
        copy_with_cancel(&mut src, &mut writer, &mut buf, token)?;

        done_bytes += entry.size_bytes;
        reporter.on_progress(JobProgress {
            phase: "zip".to_string(),
            done: (idx + 1) as u64,
            total: total_files,
            bytes_done: done_bytes,
            bytes_total: total_bytes,
            current_item: entry.archive_path.clone(),
        });
    }

    writer
        .finish()
        .map_err(|e| KnitError::Internal(e.to_string()))?;
    Ok(())
}

fn build_zip_options<'k>(
    level: CompressionLevel,
    encryption: &'k ZipEncryption,
    size_bytes: u64,
) -> Result<FileOptions<'k, 'static, ()>> {
    let (method, zip_level) = match level {
        CompressionLevel::Store => (CompressionMethod::Stored, None),
        CompressionLevel::Fast => (CompressionMethod::Deflated, Some(1)),
        CompressionLevel::Normal => (CompressionMethod::Deflated, Some(6)),
        CompressionLevel::Best => (CompressionMethod::Deflated, Some(9)),
    };

    let mut opts = SimpleFileOptions::default()
        .compression_method(method)
        .large_file(size_bytes >= (u32::MAX as u64));
    if let Some(lv) = zip_level {
        opts = opts.compression_level(Some(lv));
    }

    match encryption {
        ZipEncryption::None => Ok(opts),
        ZipEncryption::Aes256(pwd) => {
            if pwd.is_empty() {
                return Err(KnitError::InvalidInput(
                    "Mật khẩu ZIP không được để trống".to_string(),
                ));
            }
            Ok(opts.with_aes_encryption(AesMode::Aes256, pwd))
        }
        ZipEncryption::ZipCrypto(pwd) => {
            if pwd.is_empty() {
                return Err(KnitError::InvalidInput(
                    "Mật khẩu ZIP không được để trống".to_string(),
                ));
            }
            #[allow(deprecated)]
            opts.with_deprecated_encryption(pwd.as_bytes())
                .map_err(|e| KnitError::Internal(e.to_string()))
        }
    }
}

fn write_tar(
    entries: &[ArchiveEntrySpec],
    tmp_path: &Path,
    options: &ArchiveOptions,
    token: &CancellationToken,
    reporter: &ThrottledReporter<ForwardReporter<'_>>,
) -> Result<()> {
    let file = BufWriter::new(File::create(tmp_path)?);
    match options.format {
        ArchiveFormat::Tar => {
            let mut builder = TarBuilder::new(file);
            append_tar_entries(&mut builder, entries, token, reporter)?;
            builder.finish()?;
        }
        ArchiveFormat::TarGz => {
            let gz_level = match options.compression {
                CompressionLevel::Store => Compression::none(),
                CompressionLevel::Fast => Compression::fast(),
                CompressionLevel::Normal => Compression::default(),
                CompressionLevel::Best => Compression::best(),
            };
            let encoder = GzEncoder::new(file, gz_level);
            let mut builder = TarBuilder::new(encoder);
            append_tar_entries(&mut builder, entries, token, reporter)?;
            let encoder = builder.into_inner()?;
            encoder.finish()?;
        }
        ArchiveFormat::TarZst => {
            let zstd_level = match options.compression {
                CompressionLevel::Store => 1,
                CompressionLevel::Fast => 1,
                CompressionLevel::Normal => 3,
                CompressionLevel::Best => 15,
            };
            let encoder = zstd::stream::write::Encoder::new(file, zstd_level)?;
            let mut builder = TarBuilder::new(encoder);
            append_tar_entries(&mut builder, entries, token, reporter)?;
            let encoder = builder.into_inner()?;
            encoder.finish()?;
        }
        ArchiveFormat::Zip => unreachable!(),
    }
    Ok(())
}

fn append_tar_entries<W: Write>(
    builder: &mut TarBuilder<W>,
    entries: &[ArchiveEntrySpec],
    token: &CancellationToken,
    reporter: &ThrottledReporter<ForwardReporter<'_>>,
) -> Result<()> {
    let total_files = entries.len() as u64;
    let total_bytes: u64 = entries.iter().map(|e| e.size_bytes).sum();
    let mut done_bytes = 0u64;

    for (idx, entry) in entries.iter().enumerate() {
        token.check()?;
        builder.append_path_with_name(&entry.source_path, &entry.archive_path)?;
        done_bytes += entry.size_bytes;
        reporter.on_progress(JobProgress {
            phase: "tar".to_string(),
            done: (idx + 1) as u64,
            total: total_files,
            bytes_done: done_bytes,
            bytes_total: total_bytes,
            current_item: entry.archive_path.clone(),
        });
    }
    Ok(())
}

fn copy_with_cancel<R: Read, W: Write>(
    reader: &mut R,
    writer: &mut W,
    buf: &mut [u8],
    token: &CancellationToken,
) -> Result<u64> {
    let mut total = 0u64;
    loop {
        token.check()?;
        let n = reader.read(buf)?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n])?;
        total += n as u64;
    }
    Ok(total)
}

struct ForwardReporter<'a>(&'a dyn JobReporter);

impl JobReporter for ForwardReporter<'_> {
    fn on_progress(&self, progress: JobProgress) {
        self.0.on_progress(progress);
    }

    fn on_log(&self, level: knit_core::JobLogLevel, message: &str) {
        self.0.on_log(level, message);
    }
}
