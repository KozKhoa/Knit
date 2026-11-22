use crate::models::{
    DocConvertOptions, DocConvertResult, DocInputKind, EngineStatus, PageOrientation, PageSizePreset,
};
use knit_core::{
    atomic_write_file, CancellationToken, JobReporter, JobReporterExt, KnitError, Result,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

struct CachedOfficePdf {
    path: PathBuf,
    file_len: u64,
    mtime_nanos: u128,
    pdf_bytes: Vec<u8>,
}

static LAST_CONVERTED_OFFICE: OnceLock<Mutex<Option<Arc<CachedOfficePdf>>>> = OnceLock::new();

/// Giải phóng bộ nhớ đệm PDF đã kết xuất gần nhất từ LibreOffice cho tệp DOCX/PPTX.
pub fn clear_office_cache() {
    if let Some(lock) = LAST_CONVERTED_OFFICE.get() {
        if let Ok(mut guard) = lock.lock() {
            *guard = None;
        }
    }
}

struct TempFileCleanupGuard(Option<PathBuf>);

impl Drop for TempFileCleanupGuard {
    fn drop(&mut self) {
        if let Some(ref p) = self.0 {
            let _ = std::fs::remove_file(p);
        }
    }
}

/// Dò tìm LibreOffice (`soffice` / `libreoffice`) có sẵn trên Windows hoặc Linux.
pub fn detect_libreoffice() -> EngineStatus {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut checked_paths: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from("soffice.exe"));
        candidates.push(PathBuf::from("soffice"));
        candidates.push(PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join(r"Programs\LibreOffice\program\soffice.exe"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("soffice"));
        candidates.push(PathBuf::from("libreoffice"));
        candidates.push(PathBuf::from("/usr/bin/soffice"));
        candidates.push(PathBuf::from("/usr/bin/libreoffice"));
        candidates.push(PathBuf::from("/usr/local/bin/soffice"));
        candidates.push(PathBuf::from("/snap/bin/libreoffice"));
    }

    for cand in candidates {
        let label = cand.display().to_string();
        checked_paths.push(label);
        if let Ok(out) = Command::new(&cand)
            .args(["--headless", "--version"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
        {
            if out.status.success() {
                let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let resolved = if cand.is_absolute() {
                    cand
                } else {
                    resolve_in_path(&cand).unwrap_or(cand)
                };
                return EngineStatus {
                    libreoffice_available: true,
                    executable_path: Some(resolved),
                    version_text: if ver.is_empty() { None } else { Some(ver) },
                    checked_paths,
                };
            }
        }
    }

    EngineStatus {
        libreoffice_available: false,
        executable_path: None,
        version_text: None,
        checked_paths,
    }
}

fn resolve_in_path(bin: &Path) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let full = dir.join(bin);
        if full.is_file() {
            return Some(full);
        }
    }
    None
}

/// Kết xuất `.docx` / `.pptx` sang bytes PDF qua LibreOffice Headless (kèm cache 1 tệp gần nhất).
pub fn compile_office_to_pdf_bytes(
    input_path: &Path,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<Vec<u8>> {
    if !input_path.is_file() {
        return Err(KnitError::NotFound(input_path.display().to_string()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let meta = std::fs::metadata(input_path)?;
    let file_len = meta.len();
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let cache_lock = LAST_CONVERTED_OFFICE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache_lock.lock() {
        if let Some(existing) = guard.as_ref() {
            if existing.path == input_path
                && existing.file_len == file_len
                && existing.mtime_nanos == mtime_nanos
            {
                return Ok(existing.pdf_bytes.clone());
            }
        }
    }

    let status = detect_libreoffice();
    let exe = status.executable_path.ok_or_else(|| {
        KnitError::Internal(
            "LibreOffice (soffice) was not found on this system. Please install LibreOffice to convert DOCX/PPTX to PDF."
                .into(),
        )
    })?;

    let tmp_dir = tempfile::tempdir()?;
    let profile_dir = tmp_dir.path().join("lo_profile");
    let out_tmp_dir = tmp_dir.path().join("out");
    std::fs::create_dir_all(&profile_dir)?;
    std::fs::create_dir_all(&out_tmp_dir)?;

    let profile_uri = path_to_file_uri(&profile_dir);
    reporter.info(format!("Running headless LibreOffice: {}", exe.display()));

    let mut child = Command::new(&exe)
        .arg("--headless")
        .arg("--nologo")
        .arg("--nodefault")
        .arg("--nofirststartwizard")
        .arg(format!("-env:UserInstallation={profile_uri}"))
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(&out_tmp_dir)
        .arg(input_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;

    let timeout = Duration::from_secs(120);
    let started = Instant::now();
    loop {
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(KnitError::Cancelled);
        }
        if let Some(exit) = child.try_wait()? {
            if !exit.success() {
                return Err(KnitError::Internal(format!(
                    "LibreOffice thoat voi ma loi {:?}",
                    exit.code()
                )));
            }
            break;
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(KnitError::Internal(
                "Qua thoi gian cho LibreOffice headless (120s)".into(),
            ));
        }
        std::thread::sleep(Duration::from_millis(80));
    }

    let expected_stem = input_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".to_string());
    let produced = out_tmp_dir.join(format!("{expected_stem}.pdf"));
    let pdf_path = if produced.is_file() {
        produced
    } else {
        std::fs::read_dir(&out_tmp_dir)?
            .filter_map(|e| e.ok().map(|x| x.path()))
            .find(|p| {
                p.extension()
                    .and_then(|s| s.to_str())
                    .map(|s| s.eq_ignore_ascii_case("pdf"))
                    .unwrap_or(false)
            })
            .ok_or_else(|| {
                KnitError::Internal("LibreOffice khong tao duoc file PDF dau ra".into())
            })?
    };

    let bytes = std::fs::read(&pdf_path)?;
    if let Ok(mut guard) = cache_lock.lock() {
        *guard = Some(Arc::new(CachedOfficePdf {
            path: input_path.to_path_buf(),
            file_len,
            mtime_nanos,
            pdf_bytes: bytes.clone(),
        }));
    }
    Ok(bytes)
}

/// Chuyển đổi `.docx` / `.pptx` sang PDF qua LibreOffice Headless với profile cô lập tạm thời.
pub fn convert_office_to_pdf(
    input_path: &Path,
    output_path: &Path,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<DocConvertResult> {
    let kind = DocInputKind::from_path(input_path).ok_or_else(|| {
        KnitError::InvalidInput(format!("Invalid Office file: {}", input_path.display()))
    })?;
    let bytes = compile_office_to_pdf_bytes(input_path, cancel, reporter)?;
    let page_count = lopdf::Document::load_metadata_mem(&bytes)
        .ok()
        .map(|m| m.page_count as usize);
    atomic_write_file(output_path, |f| Ok(f.write_all(&bytes)?))?;

    Ok(DocConvertResult {
        input_path: input_path.to_path_buf(),
        output_path: output_path.to_path_buf(),
        kind,
        page_count,
        bytes_written: bytes.len() as u64,
        used_external_engine: true,
    })
}

/// Dò tìm trình duyệt nhân Chromium (`google-chrome`, `chromium`, `brave-browser`, `microsoft-edge`) trên hệ thống.
pub fn detect_chromium_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from("chrome.exe"));
        candidates.push(PathBuf::from("msedge.exe"));
        candidates.push(PathBuf::from("brave.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"));
        candidates.push(PathBuf::from(r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local_p = PathBuf::from(local);
            candidates.push(local_p.join(r"Google\Chrome\Application\chrome.exe"));
            candidates.push(local_p.join(r"BraveSoftware\Brave-Browser\Application\brave.exe"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        candidates.push(PathBuf::from("google-chrome"));
        candidates.push(PathBuf::from("google-chrome-stable"));
        candidates.push(PathBuf::from("chromium"));
        candidates.push(PathBuf::from("chromium-browser"));
        candidates.push(PathBuf::from("brave-browser"));
        candidates.push(PathBuf::from("microsoft-edge"));
        candidates.push(PathBuf::from("/usr/bin/google-chrome"));
        candidates.push(PathBuf::from("/usr/bin/google-chrome-stable"));
        candidates.push(PathBuf::from("/usr/bin/chromium"));
        candidates.push(PathBuf::from("/usr/bin/chromium-browser"));
        candidates.push(PathBuf::from("/usr/bin/brave-browser"));
        candidates.push(PathBuf::from("/usr/bin/microsoft-edge"));
        candidates.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        candidates.push(PathBuf::from("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
        candidates.push(PathBuf::from("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"));
    }

    for cand in candidates {
        if cand.is_absolute() {
            if cand.is_file() {
                return Some(cand);
            }
        } else if let Some(resolved) = resolve_in_path(&cand) {
            return Some(resolved);
        }
    }
    None
}

fn inject_browser_print_styles(raw_html: &str, opts: &DocConvertOptions) -> String {
    let lower = raw_html.to_ascii_lowercase();
    let has_at_page = lower.contains("@page");

    let page_rule = if has_at_page {
        String::new()
    } else if raw_html.contains("1920px") && raw_html.contains("1080px") && lower.contains("@media print")
    {
        "@page { size: 1920px 1080px; margin: 0; }".to_string()
    } else {
        let size_kw = match opts.page_size {
            PageSizePreset::A4 => "A4",
            PageSizePreset::Letter => "letter",
            PageSizePreset::A5 => "A5",
        };
        let orient_kw = match opts.orientation {
            PageOrientation::Portrait => "portrait",
            PageOrientation::Landscape => "landscape",
        };
        let margin = opts.margin_mm.clamp(5.0, 60.0);
        format!("@page {{ size: {size_kw} {orient_kw}; margin: {margin}mm; }}")
    };

    let print_script = "<script data-knit-print>window.alert=function(){};window.confirm=function(){return true;};window.prompt=function(){return null;};</script>";
    let print_style = format!(
        "<style data-knit-print>{page_rule} *, *::before, *::after {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }}</style>"
    );
    let injected = format!("{print_script}{print_style}");

    if let Some(head_start) = lower.find("<head") {
        if let Some(rel_end) = lower[head_start..].find('>') {
            let insert_at = head_start + rel_end + 1;
            let mut out = String::with_capacity(raw_html.len() + injected.len());
            out.push_str(&raw_html[..insert_at]);
            out.push_str(&injected);
            out.push_str(&raw_html[insert_at..]);
            return out;
        }
    }
    if let Some(pos) = lower.find("</head>") {
        let mut out = String::with_capacity(raw_html.len() + injected.len());
        out.push_str(&raw_html[..pos]);
        out.push_str(&injected);
        out.push_str(&raw_html[pos..]);
        out
    } else if let Some(pos) = lower.find("<body") {
        let mut out = String::with_capacity(raw_html.len() + injected.len());
        out.push_str(&raw_html[..pos]);
        out.push_str(&injected);
        out.push_str(&raw_html[pos..]);
        out
    } else {
        format!(
            "<!DOCTYPE html><html><head><meta charset=\"utf-8\">{injected}</head><body>{raw_html}</body></html>"
        )
    }
}

/// Kết xuất HTML sang bytes PDF thông qua trình duyệt Chromium/Chrome/Edge/Brave headless để giữ nguyên CSS/layout trình duyệt.
/// Trả về `Ok(None)` nếu hệ thống chưa có trình duyệt Chromium hoặc quá trình in headless không thành công (cho phép fallback về Typst).
pub fn compile_html_via_browser_to_pdf_bytes(
    html_content: Option<&str>,
    input_path: Option<&Path>,
    base_dir: Option<&Path>,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
) -> Result<Option<(Vec<u8>, usize)>> {
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }
    let Some(browser_exe) = detect_chromium_browser() else {
        return Ok(None);
    };

    let raw_html = if let Some(text) = html_content {
        text.to_string()
    } else if let Some(path) = input_path {
        std::fs::read_to_string(path)?
    } else {
        return Ok(None);
    };

    let styled_html = inject_browser_print_styles(&raw_html, opts);
    let tmp_dir = tempfile::tempdir()?;
    let out_pdf = tmp_dir.path().join("rendered.pdf");

    let resolved_base = base_dir
        .filter(|d| d.is_dir())
        .or_else(|| input_path.and_then(|p| p.parent()).filter(|d| d.is_dir()));

    let mut html_guard = TempFileCleanupGuard(None);
    let html_file_path = if let Some(dir) = resolved_base {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let cand = dir.join(format!(".knit_html_render_{}_{}.html", std::process::id(), nanos));
        if std::fs::write(&cand, styled_html.as_bytes()).is_ok() {
            html_guard.0 = Some(cand.clone());
            cand
        } else {
            let p = tmp_dir.path().join("document.html");
            std::fs::write(&p, styled_html.as_bytes())?;
            p
        }
    } else {
        let p = tmp_dir.path().join("document.html");
        std::fs::write(&p, styled_html.as_bytes())?;
        p
    };

    let file_uri = path_to_file_uri(&html_file_path);
    let mut cmd = Command::new(&browser_exe);
    cmd.arg("--headless")
        .arg("--disable-gpu")
        .arg("--no-sandbox")
        .arg("--disable-dev-shm-usage")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg("--allow-file-access-from-files")
        .arg("--no-pdf-header-footer")
        .arg(format!("--print-to-pdf={}", out_pdf.display()))
        .arg(&file_uri)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let Ok(mut child) = cmd.spawn() else {
        return Ok(None);
    };

    let timeout = Duration::from_secs(20);
    let started = Instant::now();
    loop {
        if cancel.is_cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err(KnitError::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Ok(None);
                }
                break;
            }
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(None);
                }
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(_) => return Ok(None),
        }
    }

    if !out_pdf.is_file() {
        return Ok(None);
    }
    let pdf_bytes = std::fs::read(&out_pdf)?;
    if !pdf_bytes.starts_with(b"%PDF-") {
        return Ok(None);
    }
    let pages = lopdf::Document::load_metadata_mem(&pdf_bytes)
        .ok()
        .map(|m| m.page_count as usize)
        .unwrap_or(1)
        .max(1);
    Ok(Some((pdf_bytes, pages)))
}

fn path_to_file_uri(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if raw.starts_with('/') {
        format!("file://{raw}")
    } else {
        format!("file:///{raw}")
    }
}
