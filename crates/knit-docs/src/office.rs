use crate::models::{DocConvertResult, DocInputKind, EngineStatus};
use knit_core::{
    atomic_write_file, CancellationToken, JobReporter, JobReporterExt, KnitError, Result,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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

/// Chuyển đổi `.docx` / `.pptx` sang PDF qua LibreOffice Headless với profile cô lập tạm thời.
pub fn convert_office_to_pdf(
    input_path: &Path,
    output_path: &Path,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<DocConvertResult> {
    let status = detect_libreoffice();
    let exe = status.executable_path.ok_or_else(|| {
        KnitError::Internal(
            "Khong tim thay LibreOffice (soffice) tren he thong. Vui long cai dat LibreOffice de chuyen doi DOCX/PPTX sang PDF."
                .into(),
        )
    })?;

    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let kind = DocInputKind::from_path(input_path).ok_or_else(|| {
        KnitError::InvalidInput(format!("Khong phai file Office hop le: {}", input_path.display()))
    })?;

    let tmp_dir = tempfile::tempdir()?;
    let profile_dir = tmp_dir.path().join("lo_profile");
    let out_tmp_dir = tmp_dir.path().join("out");
    std::fs::create_dir_all(&profile_dir)?;
    std::fs::create_dir_all(&out_tmp_dir)?;

    let profile_uri = path_to_file_uri(&profile_dir);
    reporter.info(format!("Dang goi LibreOffice headless: {}", exe.display()));

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
    atomic_write_file(output_path, |f| Ok(f.write_all(&bytes)?))?;

    Ok(DocConvertResult {
        input_path: input_path.to_path_buf(),
        output_path: output_path.to_path_buf(),
        kind,
        page_count: None,
        bytes_written: bytes.len() as u64,
        used_external_engine: true,
    })
}

fn path_to_file_uri(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if raw.starts_with('/') {
        format!("file://{raw}")
    } else {
        format!("file:///{raw}")
    }
}
