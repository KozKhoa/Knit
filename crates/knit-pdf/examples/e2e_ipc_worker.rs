use image::codecs::jpeg::JpegEncoder;
use image::{Rgb, RgbImage};
use knit_core::{CancellationToken, JobLogLevel, JobProgress, JobReporter};
use knit_pdf::{
    build_pdf_from_drafts, read_outlines, render_image_thumbnail_jpeg,
    render_page_draft_preview_jpeg, scan_image_files_with_reporter, scan_image_folder_with_reporter,
    AnimatedImagePolicy, BookmarkNode, Image2PdfConfig, ImageScanResult, PageDraft,
};
use lopdf::{Document, Object};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JobEvent {
    Progress { data: JobProgress },
    Log { level: JobLogLevel, message: String },
}

struct EventCollectorReporter {
    events: Mutex<Vec<JobEvent>>,
}

impl EventCollectorReporter {
    fn new() -> Self {
        Self {
            events: Mutex::new(Vec::new()),
        }
    }

    fn take_events(&self) -> Vec<JobEvent> {
        self.events
            .lock()
            .map(|mut g| std::mem::take(&mut *g))
            .unwrap_or_default()
    }
}

impl JobReporter for EventCollectorReporter {
    fn on_progress(&self, progress: JobProgress) {
        if let Ok(mut guard) = self.events.lock() {
            guard.push(JobEvent::Progress { data: progress });
        }
    }

    fn on_log(&self, level: JobLogLevel, message: &str) {
        if let Ok(mut guard) = self.events.lock() {
            guard.push(JobEvent::Log {
                level,
                message: message.to_string(),
            });
        }
    }
}

#[derive(Deserialize)]
struct WorkerRequest {
    id: u64,
    cmd: String,
    #[serde(default)]
    args: Value,
}

#[derive(Serialize)]
struct WorkerResponse {
    id: u64,
    ok: Value,
    events: Vec<JobEvent>,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupFixtureArgs {
    root_dir: PathBuf,
    page_count: usize,
    include_bookmarks: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanImagesArgs {
    paths: Vec<PathBuf>,
    is_folder: bool,
    animated_policy: AnimatedImagePolicy,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderThumbArgs {
    path: PathBuf,
    max_width: u32,
    cache_dir: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderDraftArgs {
    draft: PageDraft,
    max_size: u32,
    cache_dir: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildPdfArgs {
    drafts: Vec<PageDraft>,
    bookmarks: Vec<BookmarkNode>,
    config: Image2PdfConfig,
}

#[derive(Deserialize)]
struct DirArg {
    dir: PathBuf,
}

#[derive(Deserialize)]
struct PathsArg {
    paths: Vec<PathBuf>,
}

#[derive(Deserialize)]
struct PathArg {
    path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheDirArg {
    cache_dir: PathBuf,
}

fn shift_bookmarks_offset(nodes: &mut [BookmarkNode], offset: usize) {
    if offset == 0 {
        return;
    }
    for node in nodes {
        node.target_page_index += offset;
        shift_bookmarks_offset(&mut node.children, offset);
    }
}

fn synthesize_sample_jpeg(width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img = RgbImage::from_fn(width, height, |x, y| {
        let border = x < 8 || y < 8 || x >= width - 8 || y >= height - 8;
        if border {
            Rgb([0, 123, 255])
        } else {
            let r = 230_u8.saturating_sub(((x * 20) / width) as u8);
            let g = 240_u8.saturating_sub(((y * 20) / height) as u8);
            Rgb([r, g, 255])
        }
    });
    let mut buf = Vec::new();
    let mut enc = JpegEncoder::new_with_quality(&mut buf, 85);
    enc.encode_image(&img).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn hash_pair(parts: &[&str], extra: u64) -> (u64, u64) {
    let mut h1 = DefaultHasher::new();
    let mut h2 = DefaultHasher::new();
    extra.hash(&mut h1);
    for p in parts {
        p.hash(&mut h1);
        p.hash(&mut h2);
    }
    "knit_e2e_v1".hash(&mut h2);
    (h1.finish(), h2.finish())
}

fn obj_to_f32(obj: &Object) -> Option<f32> {
    match obj {
        Object::Real(v) => Some(*v as f32),
        Object::Integer(v) => Some(*v as f32),
        _ => None,
    }
}

fn extract_page_dimensions_pt(doc: &Document) -> Vec<[f32; 2]> {
    let pages = doc.get_pages();
    let mut dims = Vec::with_capacity(pages.len());
    for page_id in pages.into_values() {
        let mut pair = [0.0_f32, 0.0_f32];
        if let Ok(dict) = doc.get_dictionary(page_id) {
            if let Ok(arr) = dict.get(b"MediaBox").and_then(Object::as_array) {
                if arr.len() >= 4 {
                    if let (Some(x0), Some(y0), Some(x1), Some(y1)) = (
                        obj_to_f32(&arr[0]),
                        obj_to_f32(&arr[1]),
                        obj_to_f32(&arr[2]),
                        obj_to_f32(&arr[3]),
                    ) {
                        pair = [(x1 - x0).abs(), (y1 - y0).abs()];
                    }
                }
            }
        }
        dims.push(pair);
    }
    dims
}

fn handle_setup_fixture(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: SetupFixtureArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
    let album_dir = parsed.root_dir.join("album");
    let export_dir = parsed.root_dir.join("exports");
    let cache_dir = parsed.root_dir.join("cache");
    std::fs::create_dir_all(&album_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    let jpeg_bytes = synthesize_sample_jpeg(800, 1200)?;
    let mut files = Vec::with_capacity(parsed.page_count);

    if parsed.include_bookmarks && parsed.page_count > 0 {
        let cover_path = album_dir.join("cover.jpg");
        std::fs::write(&cover_path, &jpeg_bytes).map_err(|e| e.to_string())?;
        files.push(cover_path.to_string_lossy().into_owned());

        let chap1_dir = album_dir.join("Chap 1");
        let chap2_dir = album_dir.join("Chap 2");
        if parsed.page_count > 1 {
            std::fs::create_dir_all(&chap1_dir).map_err(|e| e.to_string())?;
        }
        if parsed.page_count > 3 {
            std::fs::create_dir_all(&chap2_dir).map_err(|e| e.to_string())?;
        }

        for idx in 1..parsed.page_count {
            let num = format!("{:03}.jpg", idx + 1);
            let target = if idx <= 2 {
                chap1_dir.join(num)
            } else {
                chap2_dir.join(num)
            };
            std::fs::write(&target, &jpeg_bytes).map_err(|e| e.to_string())?;
            files.push(target.to_string_lossy().into_owned());
        }
    } else {
        for idx in 0..parsed.page_count {
            let num = format!("{:03}.jpg", idx + 1);
            let target = album_dir.join(num);
            std::fs::write(&target, &jpeg_bytes).map_err(|e| e.to_string())?;
            files.push(target.to_string_lossy().into_owned());
        }
    }

    Ok((
        json!({
            "albumDir": album_dir,
            "exportDir": export_dir,
            "cacheDir": cache_dir,
            "files": files,
        }),
        Vec::new(),
    ))
}

fn handle_pdf_scan_images(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: ScanImagesArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
    if parsed.paths.is_empty() {
        return Err("Chua chon anh hoac thu muc anh".to_string());
    }
    let reporter = EventCollectorReporter::new();
    let mut all_pages = Vec::new();
    let mut all_bookmarks = Vec::new();
    let mut all_warnings = Vec::new();
    let mut loose_files = Vec::new();

    for p in parsed.paths {
        if parsed.is_folder || p.is_dir() {
            let mut res = scan_image_folder_with_reporter(&p, parsed.animated_policy, &reporter)
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
        let mut res = scan_image_files_with_reporter(&loose_files, parsed.animated_policy, &reporter)
            .map_err(|e| e.to_string())?;
        let offset = all_pages.len();
        shift_bookmarks_offset(&mut res.bookmarks, offset);
        all_pages.extend(res.pages);
        all_bookmarks.extend(res.bookmarks);
        all_warnings.extend(res.warnings);
    }

    for (idx, page) in all_pages.iter_mut().enumerate() {
        page.id = format!("p{}", idx + 1);
    }

    let result = ImageScanResult {
        pages: all_pages,
        bookmarks: all_bookmarks,
        warnings: all_warnings,
    };
    let ok = serde_json::to_value(result).map_err(|e| e.to_string())?;
    Ok((ok, reporter.take_events()))
}

fn handle_render_image_thumb_file(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: RenderThumbArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&parsed.cache_dir).map_err(|e| e.to_string())?;
    let path_str = parsed.path.to_string_lossy();
    let (h1, h2) = hash_pair(&[path_str.as_ref()], u64::from(parsed.max_width));
    let out_path = parsed
        .cache_dir
        .join(format!("thumb_{h1:016x}{h2:016x}_{}.jpg", parsed.max_width));
    if !out_path.is_file() {
        let jpg =
            render_image_thumbnail_jpeg(&parsed.path, parsed.max_width, 75).map_err(|e| e.to_string())?;
        std::fs::write(&out_path, &jpg).map_err(|e| e.to_string())?;
    }
    let ok = serde_json::to_value(out_path).map_err(|e| e.to_string())?;
    Ok((ok, Vec::new()))
}

fn handle_render_page_draft_preview_file(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: RenderDraftArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&parsed.cache_dir).map_err(|e| e.to_string())?;
    let serialized = serde_json::to_string(&parsed.draft).map_err(|e| e.to_string())?;
    let (h1, h2) = hash_pair(&[&serialized], u64::from(parsed.max_size));
    let out_path = parsed
        .cache_dir
        .join(format!("draft_{h1:016x}{h2:016x}_{}.jpg", parsed.max_size));
    if !out_path.is_file() {
        let jpg = render_page_draft_preview_jpeg(&parsed.draft, parsed.max_size, 82)
            .map_err(|e| e.to_string())?;
        std::fs::write(&out_path, &jpg).map_err(|e| e.to_string())?;
    }
    let ok = serde_json::to_value(out_path).map_err(|e| e.to_string())?;
    Ok((ok, Vec::new()))
}

fn handle_validate_export_directory(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: DirArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    if parsed.dir.as_os_str().is_empty() {
        return Ok((
            json!({ "exists": false, "is_dir": false, "writable": false, "error": "Empty directory" }),
            Vec::new(),
        ));
    }
    if !parsed.dir.exists() {
        return Ok((
            json!({
                "exists": false,
                "is_dir": false,
                "writable": false,
                "error": format!("Directory not found: {}", parsed.dir.display()),
            }),
            Vec::new(),
        ));
    }
    if !parsed.dir.is_dir() {
        return Ok((
            json!({
                "exists": true,
                "is_dir": false,
                "writable": false,
                "error": format!("Not a directory: {}", parsed.dir.display()),
            }),
            Vec::new(),
        ));
    }
    let probe = parsed
        .dir
        .join(format!(".knit_e2e_probe_{}", std::process::id()));
    let writable = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(f) => {
            drop(f);
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    };
    Ok((
        json!({
            "exists": true,
            "is_dir": true,
            "writable": writable,
            "error": if writable { Value::Null } else { json!("Directory is not writable") },
        }),
        Vec::new(),
    ))
}

fn handle_check_missing_files(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: PathsArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    let mut missing = Vec::new();
    for p in parsed.paths {
        if seen.insert(p.clone()) && !p.is_file() {
            missing.push(p);
        }
    }
    Ok((
        serde_json::to_value(missing).map_err(|e| e.to_string())?,
        Vec::new(),
    ))
}

fn handle_check_export_conflicts(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: PathsArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    let conflicts: Vec<PathBuf> = parsed.paths.into_iter().filter(|p| p.exists()).collect();
    Ok((
        serde_json::to_value(conflicts).map_err(|e| e.to_string())?,
        Vec::new(),
    ))
}

fn handle_resolve_unique_export_path(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: PathArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    if !parsed.path.exists() {
        return Ok((
            serde_json::to_value(parsed.path).map_err(|e| e.to_string())?,
            Vec::new(),
        ));
    }
    let parent = parsed
        .path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = parsed
        .path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let ext = parsed.path.extension().and_then(|s| s.to_str());
    for idx in 1..=9999 {
        let file_name = match ext {
            Some(e) if !e.is_empty() => format!("{stem}_{idx}.{e}"),
            _ => format!("{stem}_{idx}"),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return Ok((
                serde_json::to_value(candidate).map_err(|e| e.to_string())?,
                Vec::new(),
            ));
        }
    }
    Ok((
        serde_json::to_value(parsed.path).map_err(|e| e.to_string())?,
        Vec::new(),
    ))
}

fn handle_clear_image_preview_cache(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: CacheDirArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    if parsed.cache_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&parsed.cache_dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
    }
    Ok((Value::Null, Vec::new()))
}

fn handle_pdf_build_from_images(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: BuildPdfArgs = serde_json::from_value(args).map_err(|e| e.to_string())?;
    let reporter = EventCollectorReporter::new();
    let token = CancellationToken::new();
    let res = build_pdf_from_drafts(
        &parsed.drafts,
        &parsed.bookmarks,
        &parsed.config,
        &token,
        &reporter,
    )
    .map_err(|e| e.to_string())?;
    let ok = serde_json::to_value(res).map_err(|e| e.to_string())?;
    Ok((ok, reporter.take_events()))
}

fn handle_inspect_exported_pdf(args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    let parsed: PathArg = serde_json::from_value(args).map_err(|e| e.to_string())?;
    if !parsed.path.is_file() {
        return Ok((
            json!({
                "exists": false,
                "file_size_bytes": 0,
                "header_magic": "",
                "page_count": 0,
                "page_dimensions_pt": [],
                "bookmarks": [],
            }),
            Vec::new(),
        ));
    }

    let bytes = std::fs::read(&parsed.path).map_err(|e| e.to_string())?;
    let file_size_bytes = bytes.len() as u64;
    let header_len = bytes.len().min(8);
    let header_magic = String::from_utf8_lossy(&bytes[..header_len]).into_owned();
    let doc = Document::load_mem(&bytes).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len();
    let page_dimensions_pt = extract_page_dimensions_pt(&doc);
    let bookmarks = read_outlines(&doc);

    Ok((
        json!({
            "exists": true,
            "file_size_bytes": file_size_bytes,
            "header_magic": header_magic,
            "page_count": page_count,
            "page_dimensions_pt": page_dimensions_pt,
            "bookmarks": bookmarks,
        }),
        Vec::new(),
    ))
}

fn dispatch(cmd: &str, args: Value) -> Result<(Value, Vec<JobEvent>), String> {
    match cmd {
        "setup_fixture" => handle_setup_fixture(args),
        "pdf_scan_images" => handle_pdf_scan_images(args),
        "render_image_thumb_file" => handle_render_image_thumb_file(args),
        "render_page_draft_preview_file" => handle_render_page_draft_preview_file(args),
        "validate_export_directory" => handle_validate_export_directory(args),
        "check_missing_files" => handle_check_missing_files(args),
        "check_export_conflicts" => handle_check_export_conflicts(args),
        "resolve_unique_export_path" => handle_resolve_unique_export_path(args),
        "clear_image_preview_cache" => handle_clear_image_preview_cache(args),
        "pdf_build_from_images" => handle_pdf_build_from_images(args),
        "inspect_exported_pdf" => handle_inspect_exported_pdf(args),
        other => Err(format!("Unknown worker command: {other}")),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line_res in stdin.lock().lines() {
        let Ok(line) = line_res else {
            break;
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let resp = match serde_json::from_str::<WorkerRequest>(trimmed) {
            Ok(req) => match dispatch(&req.cmd, req.args) {
                Ok((ok, events)) => WorkerResponse {
                    id: req.id,
                    ok,
                    events,
                    error: None,
                },
                Err(err) => WorkerResponse {
                    id: req.id,
                    ok: Value::Null,
                    events: Vec::new(),
                    error: Some(err),
                },
            },
            Err(err) => WorkerResponse {
                id: 0,
                ok: Value::Null,
                events: Vec::new(),
                error: Some(format!("Invalid request JSON: {err}")),
            },
        };

        if let Ok(out) = serde_json::to_string(&resp) {
            let _ = writeln!(stdout, "{out}");
            let _ = stdout.flush();
        }
    }
}
