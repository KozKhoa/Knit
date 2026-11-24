use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use knit_archive::{
    collect_entries, estimate_archive_entries, estimate_archive_output, pack_entries,
    ArchiveEntrySpec, ArchiveEstimate, ArchiveOptions, ArchiveSummary,
};
use knit_core::job::ThrottledReporter;
use knit_core::{
    app_cache_dir, app_config_dir, sanitize_filename, CancellationToken, JobLogLevel,
    JobProgress, JobReporter, LogVerbosity, NoopReporter,
};
use knit_docs::{
    clear_epub_cache, clear_office_cache, compile_epub_to_pdf_bytes, compile_office_to_pdf_bytes,
    compile_text_to_pdf_bytes, compile_text_to_pdf_bytes_with_cancel, convert_document_to_pdf,
    convert_text_to_pdf, detect_libreoffice, evict_typst_cache, read_utf8_text, write_utf8_text,
    DocConvertOptions, DocConvertResult, DocInputKind, EngineStatus,
};
use knit_manga::{default_output_name, pack_stories, scan_stories, MangaPackOptions, MangaPackSummary, MangaScanMode, Story};
use knit_pdf::{
    build_pdf_from_drafts, clear_pdf_reader_cache, evict_pdf_reader_cache_paths,
    expand_drafts_for_animated_policy, inspect_pdf, merge_pdfs, render_image_thumbnail,
    render_image_thumbnail_jpeg, render_page_draft_preview_jpeg, render_pdf_bytes_thumbnails,
    render_pdf_thumbnail, render_pdf_thumbnail_jpeg, scan_image_files_with_reporter,
    scan_image_folder_with_reporter, split_multi_pdf, split_pdf, AnimatedImagePolicy,
    BookmarkNode, Image2PdfConfig, ImageScanResult, PageDraft, PageSource, PdfBuildResult,
    PdfInfo, PdfMergeConfig, PdfSplitRule,
};
use knit_renamer::{
    apply_rename_plan, build_rename_plan, compile_rule, recompute_collisions, scan_items,
    undo_manifest, PresetStore, RenameExecutionResult, RenameItem, RenamePlan, RenameRule,
    ScanFilter, UserPreset,
};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{Manager, State, Window};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JobEvent {
    Progress { data: JobProgress },
    Log { level: JobLogLevel, message: String },
}

struct ChannelReporter {
    channel: Channel<JobEvent>,
    verbosity: Arc<AtomicU8>,
}

impl JobReporter for ChannelReporter {
    fn on_progress(&self, progress: JobProgress) {
        let _ = self.channel.send(JobEvent::Progress { data: progress });
    }

    fn on_log(&self, level: JobLogLevel, message: &str) {
        let _ = self.channel.send(JobEvent::Log {
            level,
            message: message.to_string(),
        });
    }

    fn on_log_detail(&self, verbosity: LogVerbosity, level: JobLogLevel, message: &str) {
        let active = LogVerbosity::from_u8(self.verbosity.load(AtomicOrdering::Relaxed));
        if verbosity <= active {
            self.on_log(level, message);
        }
    }
}

struct CachedRenamerScan {
    roots: Vec<PathBuf>,
    filter: ScanFilter,
    items: Vec<RenameItem>,
}

struct CpuSample {
    instant: Instant,
    cpu_nanos: u64,
}

#[derive(Clone, Serialize)]
pub struct AppMetrics {
    pub cpu_percent: f64,
    pub ram_bytes: u64,
    pub process_count: usize,
}

pub struct AppState {
    jobs: Mutex<HashMap<String, CancellationToken>>,
    docs_preview_cancel: Mutex<Option<CancellationToken>>,
    preset_store: Mutex<PresetStore>,
    undo_manifest_path: PathBuf,
    renamer_scan_cache: Mutex<Option<CachedRenamerScan>>,
    last_cpu_sample: Mutex<Option<CpuSample>>,
    log_verbosity: Arc<AtomicU8>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            docs_preview_cancel: Mutex::new(None),
            preset_store: Mutex::new(PresetStore::default_os()),
            undo_manifest_path: app_config_dir().join("last_rename_undo.json"),
            renamer_scan_cache: Mutex::new(None),
            last_cpu_sample: Mutex::new(None),
            log_verbosity: Arc::new(AtomicU8::new(LogVerbosity::Normal as u8)),
        }
    }
}

impl AppState {
    fn invalidate_renamer_cache(&self) {
        if let Ok(mut guard) = self.renamer_scan_cache.lock() {
            *guard = None;
        }
    }

    fn register_job(&self, job_id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        if let Ok(mut guard) = self.jobs.lock() {
            guard.insert(job_id.to_string(), token.clone());
        }
        token
    }

    fn finish_job(&self, job_id: &str) {
        if let Ok(mut guard) = self.jobs.lock() {
            guard.remove(job_id);
        }
    }
}

fn make_reporter(
    state: &AppState,
    on_event: Channel<JobEvent>,
) -> ThrottledReporter<ChannelReporter> {
    ThrottledReporter::new(
        ChannelReporter {
            channel: on_event,
            verbosity: Arc::clone(&state.log_verbosity),
        },
        Duration::from_millis(100),
    )
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
fn trim_process_heap() {
    extern "C" {
        fn malloc_trim(pad: usize) -> std::ffi::c_int;
    }
    // SAFETY: `malloc_trim(0)` asks glibc ptmalloc2 to return free top-of-heap arenas to OS RSS.
    unsafe {
        let _ = malloc_trim(0);
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
fn trim_process_heap() {}

#[tauri::command]
fn set_log_verbosity(verbosity: LogVerbosity, state: State<'_, Arc<AppState>>) {
    state
        .log_verbosity
        .store(verbosity as u8, AtomicOrdering::Relaxed);
}

#[tauri::command]
async fn clear_image_preview_cache() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = thumb_cache_dir();
        if dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        let _ = std::fs::remove_file(p);
                    }
                }
            }
        }
        clear_pdf_reader_cache();
        clear_epub_cache();
        clear_office_cache();
        evict_typst_cache();
        trim_process_heap();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
pub struct ExportDirStatus {
    pub exists: bool,
    pub is_dir: bool,
    pub writable: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn validate_export_directory(dir: PathBuf) -> Result<ExportDirStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if dir.as_os_str().is_empty() {
            return Ok(ExportDirStatus {
                exists: false,
                is_dir: false,
                writable: false,
                error: Some("Đường dẫn thư mục trống".into()),
            });
        }
        if !dir.exists() {
            return Ok(ExportDirStatus {
                exists: false,
                is_dir: false,
                writable: false,
                error: Some(format!("Thư mục không tồn tại: {}", dir.display())),
            });
        }
        if !dir.is_dir() {
            return Ok(ExportDirStatus {
                exists: true,
                is_dir: false,
                writable: false,
                error: Some(format!("Đường dẫn không phải thư mục: {}", dir.display())),
            });
        }

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let probe = dir.join(format!(".knit_write_probe_{}_{}", std::process::id(), nanos));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(f) => {
                drop(f);
                let _ = std::fs::remove_file(&probe);
                Ok(ExportDirStatus {
                    exists: true,
                    is_dir: true,
                    writable: true,
                    error: None,
                })
            }
            Err(e) => Ok(ExportDirStatus {
                exists: true,
                is_dir: true,
                writable: false,
                error: Some(format!("Không có quyền ghi vào thư mục: {e}")),
            }),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_export_conflicts(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(paths.into_iter().filter(|p| p.exists()).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_missing_files(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut seen = std::collections::HashSet::new();
        let mut missing = Vec::new();
        for p in paths {
            if seen.insert(p.clone()) && !p.is_file() {
                missing.push(p);
            }
        }
        Ok(missing)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn resolve_unique_export_path(path: PathBuf) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !path.exists() {
            return Ok(path);
        }
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("output");
        let ext = path.extension().and_then(|s| s.to_str());
        for idx in 1..=9999 {
            let file_name = match ext {
                Some(e) if !e.is_empty() => format!("{stem}_{idx}.{e}"),
                _ => format!("{stem}_{idx}"),
            };
            let candidate = parent.join(file_name);
            if !candidate.exists() {
                return Ok(candidate);
            }
        }
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_job(job_id: String, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    if let Ok(guard) = state.jobs.lock() {
        if let Some(tok) = guard.get(&job_id) {
            tok.cancel();
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogFilterArg {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogOpenArgs {
    title: Option<String>,
    #[serde(default)]
    multiple: bool,
    #[serde(default)]
    directory: bool,
    #[serde(default)]
    filters: Vec<DialogFilterArg>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DialogSaveArgs {
    title: Option<String>,
    default_path: Option<PathBuf>,
    #[serde(default)]
    filters: Vec<DialogFilterArg>,
}

fn shift_bookmarks_offset(nodes: &mut [BookmarkNode], offset: usize) {
    for n in nodes {
        n.target_page_index += offset;
        shift_bookmarks_offset(&mut n.children, offset);
    }
}

/// Native file/folder open dialog with explicit parent-window binding across Windows, macOS, and Linux.
#[tauri::command]
async fn dialog_pick_paths(
    window: Window,
    args: DialogOpenArgs,
) -> Result<Vec<String>, String> {
    let mut builder = window.dialog().file().set_parent(&window);
    if let Some(title) = args.title {
        builder = builder.set_title(title);
    }
    for f in args.filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(f.name, &exts);
    }
    tauri::async_runtime::spawn_blocking(move || {
        if args.directory {
            if args.multiple {
                Ok(builder
                    .blocking_pick_folders()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|p| p.to_string())
                    .collect())
            } else {
                Ok(builder
                    .blocking_pick_folder()
                    .into_iter()
                    .map(|p| p.to_string())
                    .collect())
            }
        } else if args.multiple {
            Ok(builder
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string())
                .collect())
        } else {
            Ok(builder
                .blocking_pick_file()
                .into_iter()
                .map(|p| p.to_string())
                .collect())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Native save dialog with explicit parent-window binding across Windows, macOS, and Linux.
#[tauri::command]
async fn dialog_save_path(
    window: Window,
    args: DialogSaveArgs,
) -> Result<Option<String>, String> {
    let mut builder = window.dialog().file().set_parent(&window);
    if let Some(title) = args.title {
        builder = builder.set_title(title);
    }
    if let Some(default_path) = args.default_path {
        if default_path.is_dir() {
            builder = builder.set_directory(default_path);
        } else {
            if let Some(parent) = default_path.parent() {
                if !parent.as_os_str().is_empty() && parent.exists() {
                    builder = builder.set_directory(parent);
                }
            }
            if let Some(name) = default_path.file_name() {
                builder = builder.set_file_name(name.to_string_lossy());
            }
        }
    }
    for f in args.filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(f.name, &exts);
    }
    tauri::async_runtime::spawn_blocking(move || {
        Ok(builder.blocking_save_file().map(|p| p.to_string()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-pdf commands ---
#[tauri::command]
async fn pdf_scan_images(
    paths: Vec<PathBuf>,
    is_folder: bool,
    animated_policy: AnimatedImagePolicy,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<ImageScanResult, String> {
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            return Err("Chua chon anh hoac thu muc anh".to_string());
        }
        let reporter = make_reporter(&state_arc, on_event);
        let mut all_pages = Vec::new();
        let mut all_bookmarks = Vec::new();
        let mut all_warnings = Vec::new();
        let mut loose_files = Vec::new();

        for p in paths {
            if is_folder || p.is_dir() {
                let mut res = scan_image_folder_with_reporter(&p, animated_policy, &reporter)
                    .map_err(|e| e.to_string())?;
                let offset = all_pages.len();
                shift_bookmarks_offset(&mut res.bookmarks, offset);
                all_pages.extend(res.pages);
                all_bookmarks.extend(res.bookmarks);
                all_warnings.extend(res.warnings);
            } else {
                loose_files.push(p);
            }
        }

        if !loose_files.is_empty() {
            let mut res =
                scan_image_files_with_reporter(&loose_files, animated_policy, &reporter)
                    .map_err(|e| e.to_string())?;
            let offset = all_pages.len();
            shift_bookmarks_offset(&mut res.bookmarks, offset);
            all_pages.extend(res.pages);
            all_bookmarks.extend(res.bookmarks);
            all_warnings.extend(res.warnings);
        }

        Ok(ImageScanResult {
            pages: all_pages,
            bookmarks: all_bookmarks,
            warnings: all_warnings,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn thumb_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEM.get_or_init(|| {
        let cpus = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let permits = (cpus / 2).clamp(2, 4);
        tokio::sync::Semaphore::new(permits)
    })
}

/// Semaphore riêng cho thao tác xem phóng to (double click) để không bao giờ bị nghẽn sau hàng đợi thumbnail nền.
fn preview_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEM.get_or_init(|| tokio::sync::Semaphore::new(2))
}

fn thumb_cache_dir() -> PathBuf {
    static DIR: OnceLock<PathBuf> = OnceLock::new();
    DIR.get_or_init(|| {
        let dir = app_cache_dir("image-thumbs");
        let _ = std::fs::create_dir_all(&dir);
        let cleanup_dir = dir.clone();
        std::thread::spawn(move || {
            let max_age = Duration::from_secs(7 * 24 * 60 * 60);
            let now = SystemTime::now();
            if let Ok(entries) = std::fs::read_dir(&cleanup_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            let is_stale = meta
                                .modified()
                                .ok()
                                .and_then(|m| now.duration_since(m).ok())
                                .map(|age| age > max_age)
                                .unwrap_or(false);
                            if is_stale {
                                let _ = std::fs::remove_file(path);
                            }
                        }
                    }
                }
            }
        });
        dir
    })
    .clone()
}

fn thumb_cache_file_path(path: &std::path::Path, max_width: u32) -> PathBuf {
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    canonical.hash(&mut h1);
    max_width.hash(&mut h1);
    "knit_thumb_v1".hash(&mut h2);
    canonical.hash(&mut h2);

    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut h1);
        meta.len().hash(&mut h2);
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                dur.as_nanos().hash(&mut h1);
                dur.as_secs().hash(&mut h2);
            }
        }
    }

    let name = format!("{:016x}{:016x}_{}.jpg", h1.finish(), h2.finish(), max_width);
    thumb_cache_dir().join(name)
}

#[tauri::command]
async fn render_image_thumb(path: PathBuf, max_width: u32) -> Result<String, String> {
    let _permit = thumb_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let png = render_image_thumbnail(&path, max_width).map_err(|e| e.to_string())?;
        Ok(BASE64.encode(png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_image_thumb_file(path: PathBuf, max_width: u32) -> Result<PathBuf, String> {
    let cache_path = thumb_cache_file_path(&path, max_width);
    if cache_path.is_file() {
        return Ok(cache_path);
    }

    let _permit = thumb_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    if cache_path.is_file() {
        return Ok(cache_path);
    }

    tauri::async_runtime::spawn_blocking(move || {
        if cache_path.is_file() {
            return Ok(cache_path);
        }
        let jpg = render_image_thumbnail_jpeg(&path, max_width, 75).map_err(|e| e.to_string())?;
        let tmp_name = format!(
            ".{}.{}.tmp",
            cache_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("thumb"),
            std::process::id()
        );
        let tmp_path = cache_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(tmp_name);
        std::fs::write(&tmp_path, &jpg).map_err(|e| e.to_string())?;
        let _ = std::fs::rename(&tmp_path, &cache_path);
        Ok(cache_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn draft_preview_cache_file_path(draft: &PageDraft, max_size: u32) -> PathBuf {
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    "knit_draft_preview_v1".hash(&mut h1);
    max_size.hash(&mut h1);
    max_size.hash(&mut h2);

    let (src_path, frame_idx) = match &draft.source {
        PageSource::ImageFile { path } => (Some(path.as_path()), 0usize),
        PageSource::AnimatedFrame { path, frame_index } => (Some(path.as_path()), *frame_index),
        PageSource::PdfPage { path, page_index } => (Some(path.as_path()), *page_index),
    };
    frame_idx.hash(&mut h1);
    frame_idx.hash(&mut h2);

    if let Some(path) = src_path {
        let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        canonical.hash(&mut h1);
        canonical.hash(&mut h2);
        if let Ok(meta) = std::fs::metadata(path) {
            meta.len().hash(&mut h1);
            if let Ok(modified) = meta.modified() {
                if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                    dur.as_nanos().hash(&mut h1);
                    dur.as_secs().hash(&mut h2);
                }
            }
        }
    }

    draft.rotation_deg.rem_euclid(360).hash(&mut h1);
    if let Ok(crop_json) = serde_json::to_string(&draft.crop) {
        crop_json.hash(&mut h1);
        crop_json.hash(&mut h2);
    }
    if let Ok(ann_json) = serde_json::to_string(&draft.annotations) {
        ann_json.hash(&mut h1);
        ann_json.hash(&mut h2);
    }

    let name = format!("draft_{:016x}{:016x}_{}.jpg", h1.finish(), h2.finish(), max_size);
    thumb_cache_dir().join(name)
}

#[tauri::command]
async fn render_page_draft_preview_file(
    draft: PageDraft,
    max_size: u32,
) -> Result<PathBuf, String> {
    let cache_path = draft_preview_cache_file_path(&draft, max_size);
    if cache_path.is_file() {
        return Ok(cache_path);
    }

    let _permit = preview_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    if cache_path.is_file() {
        return Ok(cache_path);
    }

    tauri::async_runtime::spawn_blocking(move || {
        if cache_path.is_file() {
            return Ok(cache_path);
        }
        let jpg = render_page_draft_preview_jpeg(&draft, max_size, 82)
            .map_err(|e| e.to_string())?;
        let tmp_name = format!(
            ".{}.{}.tmp",
            cache_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("draft"),
            std::process::id()
        );
        let tmp_path = cache_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(tmp_name);
        std::fs::write(&tmp_path, &jpg).map_err(|e| e.to_string())?;
        let _ = std::fs::rename(&tmp_path, &cache_path);
        Ok(cache_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_pdf_thumb(
    path: PathBuf,
    page_index: usize,
    max_width: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let png = render_pdf_thumbnail(&path, page_index, max_width).map_err(|e| e.to_string())?;
        Ok(BASE64.encode(png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_pdf_thumb_file(
    path: PathBuf,
    page_index: usize,
    max_width: u32,
) -> Result<PathBuf, String> {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(&path) {
        meta.len().hash(&mut hasher);
        if let Ok(mtime) = meta.modified() {
            if let Ok(dur) = mtime.duration_since(UNIX_EPOCH) {
                dur.as_secs().hash(&mut hasher);
            }
        }
    }
    page_index.hash(&mut hasher);
    max_width.hash(&mut hasher);
    let cache_path = thumb_cache_dir().join(format!(
        "pdf_thumb_{:016x}_{}_{}.jpg",
        hasher.finish(),
        page_index,
        max_width
    ));
    if cache_path.is_file() {
        return Ok(cache_path);
    }

    let _permit = thumb_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    if cache_path.is_file() {
        return Ok(cache_path);
    }

    tauri::async_runtime::spawn_blocking(move || {
        if cache_path.is_file() {
            return Ok(cache_path);
        }
        let jpg = render_pdf_thumbnail_jpeg(&path, page_index, max_width, 78)
            .map_err(|e| e.to_string())?;
        let tmp_name = format!(
            ".{}.{}.tmp",
            cache_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("pdf_thumb"),
            std::process::id()
        );
        let tmp_path = cache_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(tmp_name);
        std::fs::write(&tmp_path, &jpg).map_err(|e| e.to_string())?;
        let _ = std::fs::rename(&tmp_path, &cache_path);
        Ok(cache_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_pdf_page_preview_file(
    path: PathBuf,
    page_index: usize,
    max_width: u32,
) -> Result<PathBuf, String> {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(&path) {
        meta.len().hash(&mut hasher);
        if let Ok(mtime) = meta.modified() {
            if let Ok(dur) = mtime.duration_since(UNIX_EPOCH) {
                dur.as_secs().hash(&mut hasher);
            }
        }
    }
    page_index.hash(&mut hasher);
    max_width.hash(&mut hasher);
    let cache_path = thumb_cache_dir().join(format!(
        "pdf_page_{:016x}_{}_{}.jpg",
        hasher.finish(),
        page_index,
        max_width
    ));
    if cache_path.is_file() {
        return Ok(cache_path);
    }

    let _permit = preview_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    if cache_path.is_file() {
        return Ok(cache_path);
    }

    tauri::async_runtime::spawn_blocking(move || {
        if cache_path.is_file() {
            return Ok(cache_path);
        }
        let jpg = render_pdf_thumbnail_jpeg(&path, page_index, max_width, 84)
            .map_err(|e| e.to_string())?;
        let tmp_name = format!(
            ".{}.{}.tmp",
            cache_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("pdf_page"),
            std::process::id()
        );
        let tmp_path = cache_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join(tmp_name);
        std::fs::write(&tmp_path, &jpg).map_err(|e| e.to_string())?;
        let _ = std::fs::rename(&tmp_path, &cache_path);
        Ok(cache_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct SyncAnimatedDraftsResult {
    pages: Vec<PageDraft>,
    bookmarks: Vec<BookmarkNode>,
}

#[tauri::command]
async fn pdf_sync_animated_drafts(
    drafts: Vec<PageDraft>,
    bookmarks: Vec<BookmarkNode>,
    animated_policy: AnimatedImagePolicy,
) -> Result<SyncAnimatedDraftsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (pages, bookmarks) =
            expand_drafts_for_animated_policy(&drafts, &bookmarks, animated_policy)
                .map_err(|e| e.to_string())?;
        Ok(SyncAnimatedDraftsResult { pages, bookmarks })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_pdf_file_bytes(path: PathBuf) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_home_dir() -> Option<String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.trim().is_empty())
}

#[tauri::command]
async fn pdf_release_cached_files(paths: Vec<PathBuf>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        evict_pdf_reader_cache_paths(&paths);
        knit_docs::evict_pdf_to_md_cache_paths(&paths);
        trim_process_heap();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf_build_from_images(
    job_id: String,
    drafts: Vec<PageDraft>,
    bookmarks: Vec<BookmarkNode>,
    config: Image2PdfConfig,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<PdfBuildResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = build_pdf_from_drafts(&drafts, &bookmarks, &config, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf_inspect(path: PathBuf) -> Result<PdfInfo, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_pdf(&path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf_merge(
    job_id: String,
    config: PdfMergeConfig,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<PdfBuildResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = merge_pdfs(&config, &token, &reporter).map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf_split(
    job_id: String,
    input_path: PathBuf,
    output_dir: PathBuf,
    stem: String,
    rule: PdfSplitRule,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<PdfBuildResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = split_pdf(&input_path, &output_dir, &stem, &rule, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf_split_multi(
    job_id: String,
    inputs: Vec<PathBuf>,
    stems: Vec<String>,
    output_dir: PathBuf,
    rule: PdfSplitRule,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<PdfBuildResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = split_multi_pdf(&inputs, &stems, &output_dir, &rule, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-docs commands ---
#[tauri::command]
async fn docs_engine_status() -> Result<EngineStatus, String> {
    tauri::async_runtime::spawn_blocking(detect_libreoffice)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn docs_check_missing_links(
    content: String,
    base_dir: Option<PathBuf>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(knit_docs::find_missing_markdown_links(
            &content,
            base_dir.as_deref(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn docs_convert_to_pdf(
    job_id: String,
    input_path: PathBuf,
    output_path: PathBuf,
    options: DocConvertOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<DocConvertResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = convert_document_to_pdf(&input_path, &output_path, &options, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
pub struct MarkdownPreviewResult {
    pub page_count: usize,
    pub pages_png_base64: Vec<String>,
}

#[tauri::command]
async fn docs_read_text_file(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_utf8_text(&path).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn docs_write_text_file(path: PathBuf, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_utf8_text(&path, &content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn docs_preview_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEM.get_or_init(|| tokio::sync::Semaphore::new(1))
}

#[tauri::command]
async fn docs_preview_pdf_bytes(
    content: Option<String>,
    input_path: Option<PathBuf>,
    input_kind: DocInputKind,
    base_dir: Option<PathBuf>,
    options: DocConvertOptions,
    state: State<'_, Arc<AppState>>,
) -> Result<tauri::ipc::Response, String> {
    let token = CancellationToken::new();
    if let Ok(mut guard) = state.docs_preview_cancel.lock() {
        if let Some(prev) = guard.replace(token.clone()) {
            prev.cancel();
        }
    }

    let _permit = docs_preview_semaphore()
        .acquire()
        .await
        .map_err(|e| e.to_string())?;

    if token.is_cancelled() {
        return Err("Job cancelled by user".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let res = match input_kind {
            DocInputKind::Epub => {
                let path = input_path
                    .ok_or_else(|| "Missing EPUB path for preview".to_string())?;
                compile_epub_to_pdf_bytes(&path, &options, &token, &NoopReporter)
                    .map_err(|e| e.to_string())
            }
            DocInputKind::Docx | DocInputKind::Pptx => {
                let path = input_path
                    .ok_or_else(|| "Missing Office path for preview".to_string())?;
                compile_office_to_pdf_bytes(&path, &token, &NoopReporter)
                    .map(|bytes| (bytes, 0))
                    .map_err(|e| e.to_string())
            }
            DocInputKind::Markdown | DocInputKind::PlainText | DocInputKind::Html => {
                let text = content.unwrap_or_default();
                compile_text_to_pdf_bytes_with_cancel(
                    &text,
                    input_kind,
                    base_dir.as_deref(),
                    &options,
                    Some(&token),
                )
                .map_err(|e| e.to_string())
            }
        };
        trim_process_heap();
        let (pdf_bytes, _) = res?;
        Ok(tauri::ipc::Response::new(pdf_bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn docs_preview_markdown(
    content: String,
    input_kind: DocInputKind,
    base_dir: Option<PathBuf>,
    options: DocConvertOptions,
    max_pages: Option<usize>,
    max_width: Option<u32>,
) -> Result<MarkdownPreviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (pdf_bytes, _) =
            compile_text_to_pdf_bytes(&content, input_kind, base_dir.as_deref(), &options)
                .map_err(|e| e.to_string())?;
        let (page_count, pngs) = render_pdf_bytes_thumbnails(
            &pdf_bytes,
            Some(max_pages.unwrap_or(20).clamp(1, 50)),
            max_width.unwrap_or(920).clamp(240, 1800),
        )
        .map_err(|e| e.to_string())?;
        Ok(MarkdownPreviewResult {
            page_count,
            pages_png_base64: pngs.into_iter().map(|p| BASE64.encode(p)).collect(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn docs_convert_content_to_pdf(
    job_id: String,
    content: String,
    input_kind: DocInputKind,
    base_dir: Option<PathBuf>,
    input_path: Option<PathBuf>,
    output_path: PathBuf,
    options: DocConvertOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<DocConvertResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = convert_text_to_pdf(
            &content,
            input_kind,
            base_dir.as_deref(),
            input_path.as_deref(),
            &output_path,
            &options,
            &token,
            &reporter,
        )
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-docs PDF -> Markdown & Gemini Assistant commands ---
#[tauri::command]
async fn pdf2md_inspect_and_extract(
    job_id: String,
    path: PathBuf,
    options: knit_docs::PdfToMdOptions,
    force_reextract: Option<bool>,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<knit_docs::PdfToMdInspectResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = knit_docs::inspect_and_extract_pdf_to_markdown_cached(
            &path,
            &options,
            force_reextract.unwrap_or(false),
            &token,
            Some(&reporter),
        )
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf2md_export(
    job_id: String,
    source_pdf_path: PathBuf,
    output_md_path: PathBuf,
    markdown: String,
    extract_images: bool,
    image_page_indices: Option<Vec<usize>>,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<knit_docs::PdfToMdExportResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = knit_docs::export_pdf_markdown_to_path_with_pages(
            &source_pdf_path,
            &output_md_path,
            &markdown,
            extract_images,
            image_page_indices.as_deref(),
            &token,
            Some(&reporter),
        )
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf2md_convert_file(
    job_id: String,
    source_pdf_path: PathBuf,
    output_md_path: PathBuf,
    options: knit_docs::PdfToMdOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<knit_docs::PdfToMdExportResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = knit_docs::convert_pdf_to_markdown_file(
            &source_pdf_path,
            &output_md_path,
            &options,
            &token,
            Some(&reporter),
        )
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pdf2md_gemini_refine(
    job_id: String,
    markdown: String,
    instruction: Option<String>,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<knit_docs::GeminiRefineDocumentResult, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = knit_docs::refine_markdown_with_gemini(
            &markdown,
            instruction.as_deref(),
            &token,
            Some(&reporter),
        )
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn gemini_get_key_status() -> Result<knit_docs::GeminiKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        knit_docs::get_gemini_key_status().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn gemini_save_key(api_key: String) -> Result<knit_docs::GeminiKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        knit_docs::save_gemini_key(&api_key).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn gemini_clear_key() -> Result<knit_docs::GeminiKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        knit_docs::clear_gemini_key().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn gemini_test_key(api_key: Option<String>) -> Result<knit_docs::GeminiKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        knit_docs::test_gemini_connection(api_key.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-archive commands ---
#[tauri::command]
async fn archive_collect_entries(
    inputs: Vec<PathBuf>,
    include_root_dir: bool,
    ignore_hidden: bool,
) -> Result<Vec<ArchiveEntrySpec>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        collect_entries(&inputs, include_root_dir, ignore_hidden).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn archive_estimate_size(
    inputs: Vec<PathBuf>,
    include_root_dir: bool,
    ignore_hidden: bool,
    options: ArchiveOptions,
    custom_entries: Option<Vec<ArchiveEntrySpec>>,
) -> Result<ArchiveEstimate, String> {
    tauri::async_runtime::spawn_blocking(move || match custom_entries {
        Some(entries) => Ok(estimate_archive_entries(&entries, &options)),
        None => estimate_archive_output(&inputs, include_root_dir, ignore_hidden, &options)
            .map_err(|e| e.to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_file_size_bytes(path: PathBuf) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::metadata(&path)
            .map(|m| m.len())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn archive_pack(
    job_id: String,
    inputs: Vec<PathBuf>,
    output_path: PathBuf,
    include_root_dir: bool,
    ignore_hidden: bool,
    options: ArchiveOptions,
    custom_entries: Option<Vec<ArchiveEntrySpec>>,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<ArchiveSummary, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = (|| {
            let entries = match custom_entries {
                Some(list) => list,
                None => collect_entries(&inputs, include_root_dir, ignore_hidden)?,
            };
            pack_entries(&entries, &output_path, &options, &token, &reporter)
        })()
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-manga commands ---
#[tauri::command]
async fn manga_scan(root: PathBuf, mode: MangaScanMode) -> Result<Vec<Story>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan_stories(&root, mode, None, 0, None, true, &NoopReporter).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn manga_pack(
    job_id: String,
    stories: Vec<Story>,
    output_dir: PathBuf,
    output_name: Option<String>,
    options: MangaPackOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<MangaPackSummary, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let chosen_name = output_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| {
                let clean = sanitize_filename(s, 140);
                let lower = clean.to_ascii_lowercase();
                if lower.ends_with(".zip") || lower.ends_with(".cbz") {
                    clean
                } else {
                    format!("{clean}.zip")
                }
            })
            .unwrap_or_else(|| default_output_name(&stories));
        let out_file = output_dir.join(chosen_name);
        let res = pack_stories(&stories, &out_file, &options, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        trim_process_heap();
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- knit-renamer commands ---
#[tauri::command]
async fn renamer_preview(
    roots: Vec<PathBuf>,
    filter: ScanFilter,
    rule: RenameRule,
    state: State<'_, Arc<AppState>>,
) -> Result<RenamePlan, String> {
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let cached_items = state_arc
            .renamer_scan_cache
            .lock()
            .ok()
            .and_then(|guard| {
                guard.as_ref().and_then(|entry| {
                    if entry.roots == roots && entry.filter == filter {
                        Some(entry.items.clone())
                    } else {
                        None
                    }
                })
            });

        let items = match cached_items {
            Some(it) => it,
            None => {
                let mut scanned = Vec::new();
                for root in &roots {
                    scanned.extend(scan_items(root, &filter).map_err(|e| e.to_string())?);
                }
                if let Ok(mut guard) = state_arc.renamer_scan_cache.lock() {
                    *guard = Some(CachedRenamerScan {
                        roots,
                        filter,
                        items: scanned.clone(),
                    });
                }
                scanned
            }
        };

        let transform = compile_rule(&rule).map_err(|e| e.to_string())?;
        Ok(build_rename_plan(items, transform))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn renamer_recompute_collisions(mut plan: RenamePlan) -> Result<RenamePlan, String> {
    recompute_collisions(&mut plan);
    Ok(plan)
}

#[tauri::command]
async fn renamer_apply(
    job_id: String,
    mut plan: RenamePlan,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<RenameExecutionResult, String> {
    let _token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    let undo_path = state.undo_manifest_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(&state_arc, on_event);
        let res = apply_rename_plan(&mut plan, Some(&undo_path), &reporter).map_err(|e| e.to_string());
        state_arc.invalidate_renamer_cache();
        state_arc.finish_job(&job_id);
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn renamer_undo_last(state: State<'_, Arc<AppState>>) -> Result<RenameExecutionResult, String> {
    let state_arc = Arc::clone(&state);
    let undo_path = state.undo_manifest_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let count = undo_manifest(&undo_path, &NoopReporter).map_err(|e| e.to_string())?;
        state_arc.invalidate_renamer_cache();
        Ok(RenameExecutionResult {
            renamed_count: count,
            skipped_count: 0,
            error_count: 0,
            undo_available: false,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn renamer_has_undo(state: State<'_, Arc<AppState>>) -> bool {
    state.undo_manifest_path.is_file()
}

#[tauri::command]
fn renamer_list_presets(state: State<'_, Arc<AppState>>) -> Result<Vec<UserPreset>, String> {
    let guard = state.preset_store.lock().map_err(|e| e.to_string())?;
    guard.load().map_err(|e| e.to_string())
}

#[tauri::command]
fn renamer_save_preset(
    preset: UserPreset,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<UserPreset>, String> {
    let guard = state.preset_store.lock().map_err(|e| e.to_string())?;
    guard
        .save_preset(Some(preset.id), preset.title, preset.description, preset.rule)
        .map_err(|e| e.to_string())?;
    guard.load().map_err(|e| e.to_string())
}

#[tauri::command]
fn renamer_delete_preset(
    id: String,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<UserPreset>, String> {
    let guard = state.preset_store.lock().map_err(|e| e.to_string())?;
    guard.delete_preset(&id).map_err(|e| e.to_string())?;
    guard.load().map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn collect_process_tree_stats() -> (u64, u64, usize) {
    let root_pid = std::process::id();
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut cpu_ticks_map: HashMap<u32, u64> = HashMap::new();

    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let Ok(fname) = entry.file_name().into_string() else {
                continue;
            };
            let Ok(pid) = fname.parse::<u32>() else {
                continue;
            };
            let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            let Some(rparen) = stat.rfind(')') else {
                continue;
            };
            let after = stat[rparen + 1..].trim_start();
            let fields: Vec<&str> = after.split_whitespace().collect();
            if fields.len() <= 12 {
                continue;
            }
            let ppid = fields[1].parse::<u32>().unwrap_or(0);
            let utime = fields[11].parse::<u64>().unwrap_or(0);
            let stime = fields[12].parse::<u64>().unwrap_or(0);
            children_map.entry(ppid).or_default().push(pid);
            cpu_ticks_map.insert(pid, utime.saturating_add(stime));
        }
    }

    let mut queue = std::collections::VecDeque::new();
    let mut visited = std::collections::HashSet::new();
    queue.push_back(root_pid);
    visited.insert(root_pid);

    while let Some(pid) = queue.pop_front() {
        if let Some(children) = children_map.get(&pid) {
            for &c in children {
                if visited.insert(c) {
                    queue.push_back(c);
                }
            }
        }
    }

    let mut total_ticks = 0u64;
    let mut total_ram_bytes = 0u64;
    for &pid in &visited {
        total_ticks = total_ticks.saturating_add(cpu_ticks_map.get(&pid).copied().unwrap_or(0));
        total_ram_bytes = total_ram_bytes.saturating_add(read_linux_process_ram_bytes(pid));
    }

    // Linux USER_HZ is 100 ticks/sec -> 10_000_000 ns per tick
    (total_ticks.saturating_mul(10_000_000), total_ram_bytes, visited.len())
}

#[cfg(target_os = "linux")]
fn parse_proc_kb_value(line: &str, prefix: &str) -> Option<u64> {
    let rest = line.strip_prefix(prefix)?;
    rest.split_whitespace().next()?.parse::<u64>().ok()
}

#[cfg(target_os = "linux")]
fn read_linux_process_ram_bytes(pid: u32) -> u64 {
    // Ưu tiên Pss_Anon + Pss_Shmem từ smaps_rollup để chia đều bộ nhớ dùng chung giữa các WebKit process
    // và không tính OS clean file page-cache (ví dụ file PDF mmap) vào RAM ứng dụng.
    if let Ok(rollup) = std::fs::read_to_string(format!("/proc/{pid}/smaps_rollup")) {
        let mut pss_anon_kb: Option<u64> = None;
        let mut pss_shmem_kb: Option<u64> = None;
        let mut pss_kb: Option<u64> = None;
        for line in rollup.lines() {
            if pss_anon_kb.is_none() {
                pss_anon_kb = parse_proc_kb_value(line, "Pss_Anon:");
            }
            if pss_shmem_kb.is_none() {
                pss_shmem_kb = parse_proc_kb_value(line, "Pss_Shmem:");
            }
            if pss_kb.is_none() {
                pss_kb = parse_proc_kb_value(line, "Pss:");
            }
        }
        if pss_anon_kb.is_some() || pss_shmem_kb.is_some() {
            return pss_anon_kb
                .unwrap_or(0)
                .saturating_add(pss_shmem_kb.unwrap_or(0))
                .saturating_mul(1024);
        }
        if let Some(pss) = pss_kb {
            return pss.saturating_mul(1024);
        }
    }

    if let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) {
        for line in status.lines() {
            if let Some(kb) = parse_proc_kb_value(line, "VmRSS:") {
                return kb.saturating_mul(1024);
            }
        }
    }
    0
}

#[cfg(target_os = "windows")]
fn collect_process_tree_stats() -> (u64, u64, usize) {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const INVALID_HANDLE_VALUE: *mut c_void = (-1isize) as *mut c_void;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    struct ProcessMemoryCounters {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: u32, th32_process_id: u32) -> *mut c_void;
        fn Process32FirstW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(h_snapshot: *mut c_void, lppe: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(dw_desired_access: u32, b_inherit_handle: i32, dw_process_id: u32) -> *mut c_void;
        fn GetProcessTimes(
            h_process: *mut c_void,
            lp_creation_time: *mut FileTime,
            lp_exit_time: *mut FileTime,
            lp_kernel_time: *mut FileTime,
            lp_user_time: *mut FileTime,
        ) -> i32;
        fn K32GetProcessMemoryInfo(
            process: *mut c_void,
            ppsmem_counters: *mut ProcessMemoryCounters,
            cb: u32,
        ) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    let root_pid = std::process::id();
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if !snap.is_null() && snap != INVALID_HANDLE_VALUE {
            let mut pe: ProcessEntry32W = zeroed();
            pe.dw_size = size_of::<ProcessEntry32W>() as u32;
            if Process32FirstW(snap, &mut pe) != 0 {
                loop {
                    children_map
                        .entry(pe.th32_parent_process_id)
                        .or_default()
                        .push(pe.th32_process_id);
                    if Process32NextW(snap, &mut pe) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }

        let mut queue = std::collections::VecDeque::new();
        let mut visited = std::collections::HashSet::new();
        queue.push_back(root_pid);
        visited.insert(root_pid);
        while let Some(pid) = queue.pop_front() {
            if let Some(children) = children_map.get(&pid) {
                for &c in children {
                    if visited.insert(c) {
                        queue.push_back(c);
                    }
                }
            }
        }

        let mut total_100ns = 0u64;
        let mut total_ram_bytes = 0u64;
        for &pid in &visited {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !h.is_null() {
                let mut c_t: FileTime = zeroed();
                let mut e_t: FileTime = zeroed();
                let mut k_t: FileTime = zeroed();
                let mut u_t: FileTime = zeroed();
                if GetProcessTimes(h, &mut c_t, &mut e_t, &mut k_t, &mut u_t) != 0 {
                    let k = ((k_t.high as u64) << 32) | (k_t.low as u64);
                    let u = ((u_t.high as u64) << 32) | (u_t.low as u64);
                    total_100ns = total_100ns.saturating_add(k).saturating_add(u);
                }
                let mut pmc: ProcessMemoryCounters = zeroed();
                pmc.cb = size_of::<ProcessMemoryCounters>() as u32;
                if K32GetProcessMemoryInfo(h, &mut pmc, pmc.cb) != 0 {
                    total_ram_bytes = total_ram_bytes.saturating_add(pmc.working_set_size as u64);
                }
                CloseHandle(h);
            }
        }
        (total_100ns.saturating_mul(100), total_ram_bytes, visited.len())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn collect_process_tree_stats() -> (u64, u64, usize) {
    (0, 0, 1)
}

#[tauri::command]
fn get_app_metrics(state: State<'_, Arc<AppState>>) -> Result<AppMetrics, String> {
    let (cpu_nanos, ram_bytes, process_count) = collect_process_tree_stats();
    let now = Instant::now();
    let logical_cpus = std::thread::available_parallelism()
        .map(|n| n.get() as f64)
        .unwrap_or(1.0)
        .max(1.0);

    let mut cpu_percent = 0.0;
    if let Ok(mut guard) = state.last_cpu_sample.lock() {
        if let Some(prev) = guard.as_ref() {
            let elapsed_nanos = now.duration_since(prev.instant).as_nanos() as f64;
            if elapsed_nanos > 1_000_000.0 && cpu_nanos >= prev.cpu_nanos {
                let delta_cpu = (cpu_nanos - prev.cpu_nanos) as f64;
                cpu_percent = ((delta_cpu / (elapsed_nanos * logical_cpus)) * 100.0).clamp(0.0, 100.0);
            }
        }
        *guard = Some(CpuSample {
            instant: now,
            cpu_nanos,
        });
    }

    Ok(AppMetrics {
        cpu_percent,
        ram_bytes,
        process_count,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(AppState::default());
    tauri::Builder::default()
        .manage(shared_state)
        .setup(|app| {
            // Tauri FsScope on Unix blocks `**` from matching dot-segments like `.cache`,
            // so explicitly allow our thumbnail cache folder on the asset protocol scope.
            let thumbs_dir = thumb_cache_dir();
            if let Err(err) = app.asset_protocol_scope().allow_directory(&thumbs_dir, true) {
                eprintln!("Failed to allow thumbnail cache directory in asset scope: {err}");
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            cancel_job,
            set_log_verbosity,
            clear_image_preview_cache,
            validate_export_directory,
            check_export_conflicts,
            check_missing_files,
            resolve_unique_export_path,
            dialog_pick_paths,
            dialog_save_path,
            pdf_scan_images,
            pdf_sync_animated_drafts,
            pdf_release_cached_files,
            get_home_dir,
            read_pdf_file_bytes,
            render_image_thumb,
            render_image_thumb_file,
            render_page_draft_preview_file,
            render_pdf_thumb,
            render_pdf_thumb_file,
            render_pdf_page_preview_file,
            get_app_metrics,
            pdf_build_from_images,
            pdf_inspect,
            pdf_merge,
            pdf_split,
            pdf_split_multi,
            docs_engine_status,
            docs_check_missing_links,
            docs_convert_to_pdf,
            docs_read_text_file,
            docs_write_text_file,
            docs_preview_pdf_bytes,
            docs_preview_markdown,
            docs_convert_content_to_pdf,
            pdf2md_inspect_and_extract,
            pdf2md_export,
            pdf2md_convert_file,
            pdf2md_gemini_refine,
            gemini_get_key_status,
            gemini_save_key,
            gemini_clear_key,
            gemini_test_key,
            get_file_size_bytes,
            archive_collect_entries,
            archive_estimate_size,
            archive_pack,
            manga_scan,
            manga_pack,
            renamer_preview,
            renamer_recompute_collisions,
            renamer_apply,
            renamer_undo_last,
            renamer_has_undo,
            renamer_list_presets,
            renamer_save_preset,
            renamer_delete_preset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Knit desktop application");
}
