use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use knit_archive::{collect_entries, pack_entries, ArchiveOptions, ArchiveSummary};
use knit_core::job::ThrottledReporter;
use knit_core::{
    app_config_dir, CancellationToken, JobLogLevel, JobProgress, JobReporter, NoopReporter,
};
use knit_docs::{
    compile_epub_to_pdf_bytes, compile_text_to_pdf_bytes, convert_document_to_pdf,
    convert_text_to_pdf, detect_libreoffice, read_utf8_text, write_utf8_text, DocConvertOptions,
    DocConvertResult, DocInputKind, EngineStatus,
};
use knit_manga::{default_output_name, pack_stories, scan_stories, MangaPackOptions, MangaPackSummary, MangaScanMode, Story};
use knit_pdf::{
    build_pdf_from_drafts, inspect_pdf, merge_pdfs, render_image_thumbnail,
    render_pdf_bytes_thumbnails, render_pdf_thumbnail, scan_image_files, scan_image_folder,
    split_pdf, AnimatedImagePolicy, BookmarkNode, Image2PdfConfig, ImageScanResult, PageDraft,
    PdfBuildResult, PdfInfo, PdfMergeConfig, PdfSplitRule,
};
use knit_renamer::{
    apply_rename_plan, build_rename_plan, compile_rule, recompute_collisions, scan_items,
    undo_manifest, PresetStore, RenameExecutionResult, RenamePlan, RenameRule, ScanFilter,
    UserPreset,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{State, Window};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum JobEvent {
    Progress { data: JobProgress },
    Log { level: JobLogLevel, message: String },
}

struct ChannelReporter {
    channel: Channel<JobEvent>,
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
}

pub struct AppState {
    jobs: Mutex<HashMap<String, CancellationToken>>,
    preset_store: Mutex<PresetStore>,
    undo_manifest_path: PathBuf,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            preset_store: Mutex::new(PresetStore::default_os()),
            undo_manifest_path: app_config_dir().join("last_rename_undo.json"),
        }
    }
}

impl AppState {
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

fn make_reporter(on_event: Channel<JobEvent>) -> ThrottledReporter<ChannelReporter> {
    ThrottledReporter::new(ChannelReporter { channel: on_event }, Duration::from_millis(100))
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
) -> Result<ImageScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            return Err("Chua chon anh hoac thu muc anh".to_string());
        }
        let mut all_pages = Vec::new();
        let mut all_bookmarks = Vec::new();
        let mut loose_files = Vec::new();

        for p in paths {
            if is_folder || p.is_dir() {
                let mut res = scan_image_folder(&p, animated_policy).map_err(|e| e.to_string())?;
                let offset = all_pages.len();
                shift_bookmarks_offset(&mut res.bookmarks, offset);
                all_pages.extend(res.pages);
                all_bookmarks.extend(res.bookmarks);
            } else {
                loose_files.push(p);
            }
        }

        if !loose_files.is_empty() {
            let mut res = scan_image_files(&loose_files, animated_policy).map_err(|e| e.to_string())?;
            let offset = all_pages.len();
            shift_bookmarks_offset(&mut res.bookmarks, offset);
            all_pages.extend(res.pages);
            all_bookmarks.extend(res.bookmarks);
        }

        Ok(ImageScanResult {
            pages: all_pages,
            bookmarks: all_bookmarks,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn render_image_thumb(path: PathBuf, max_width: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let png = render_image_thumbnail(&path, max_width).map_err(|e| e.to_string())?;
        Ok(BASE64.encode(png))
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
        let reporter = make_reporter(on_event);
        let res = build_pdf_from_drafts(&drafts, &bookmarks, &config, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
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
        let reporter = make_reporter(on_event);
        let res = merge_pdfs(&config, &token, &reporter).map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
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
        let reporter = make_reporter(on_event);
        let res = split_pdf(&input_path, &output_dir, &stem, &rule, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
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
        let reporter = make_reporter(on_event);
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

#[tauri::command]
async fn docs_preview_pdf_bytes(
    content: Option<String>,
    input_path: Option<PathBuf>,
    input_kind: DocInputKind,
    base_dir: Option<PathBuf>,
    options: DocConvertOptions,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (pdf_bytes, _) = match input_kind {
            DocInputKind::Epub => {
                let path = input_path
                    .ok_or_else(|| "Thieu duong dan EPUB de xem truoc".to_string())?;
                compile_epub_to_pdf_bytes(&path, &options, &CancellationToken::new(), &NoopReporter)
                    .map_err(|e| e.to_string())?
            }
            DocInputKind::Markdown | DocInputKind::PlainText | DocInputKind::Html => {
                let text = content.unwrap_or_default();
                compile_text_to_pdf_bytes(&text, input_kind, base_dir.as_deref(), &options)
                    .map_err(|e| e.to_string())?
            }
            _ => {
                return Err(
                    "Chi ho tro xem truoc PDF cho Markdown, Plain Text, HTML va EPUB".to_string(),
                )
            }
        };
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
        let reporter = make_reporter(on_event);
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

// --- knit-archive commands ---
#[tauri::command]
async fn archive_pack(
    job_id: String,
    inputs: Vec<PathBuf>,
    output_path: PathBuf,
    include_root_dir: bool,
    ignore_hidden: bool,
    options: ArchiveOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<ArchiveSummary, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(on_event);
        let res = (|| {
            let entries = collect_entries(&inputs, include_root_dir, ignore_hidden)?;
            pack_entries(&entries, &output_path, &options, &token, &reporter)
        })()
        .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
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
    options: MangaPackOptions,
    on_event: Channel<JobEvent>,
    state: State<'_, Arc<AppState>>,
) -> Result<MangaPackSummary, String> {
    let token = state.register_job(&job_id);
    let state_arc = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        let reporter = make_reporter(on_event);
        let out_file = output_dir.join(default_output_name(&stories));
        let res = pack_stories(&stories, &out_file, &options, &token, &reporter)
            .map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
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
) -> Result<RenamePlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::new();
        for root in &roots {
            items.extend(scan_items(root, &filter).map_err(|e| e.to_string())?);
        }
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
        let reporter = make_reporter(on_event);
        let res = apply_rename_plan(&mut plan, Some(&undo_path), &reporter).map_err(|e| e.to_string());
        state_arc.finish_job(&job_id);
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn renamer_undo_last(state: State<'_, Arc<AppState>>) -> Result<RenameExecutionResult, String> {
    let undo_path = state.undo_manifest_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let count = undo_manifest(&undo_path, &NoopReporter).map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shared_state = Arc::new(AppState::default());
    tauri::Builder::default()
        .manage(shared_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            cancel_job,
            dialog_pick_paths,
            dialog_save_path,
            pdf_scan_images,
            render_image_thumb,
            render_pdf_thumb,
            pdf_build_from_images,
            pdf_inspect,
            pdf_merge,
            pdf_split,
            docs_engine_status,
            docs_convert_to_pdf,
            docs_read_text_file,
            docs_write_text_file,
            docs_preview_pdf_bytes,
            docs_preview_markdown,
            docs_convert_content_to_pdf,
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
