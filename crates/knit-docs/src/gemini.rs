use knit_core::{
    app_config_dir, atomic_write_file, nfc_normalize, CancellationToken, JobProgress, JobReporter,
    KnitError, NoopReporter, Result,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tempfile::NamedTempFile;

pub const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-flash";
pub const DEFAULT_GEMINI_MODELS: &[&str] = &[
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
];
const KEYCHAIN_SERVICE: &str = "knit-desktop";
const KEYCHAIN_ACCOUNT: &str = "gemini_api_key";

/// Trạng thái cấu hình Gemini API Key (không bao giờ trả raw key về UI).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiKeyStatus {
    pub configured: bool,
    pub masked_key: Option<String>,
    pub storage_backend: String,
    pub model: String,
}

/// Kết quả hậu xử lý Markdown theo từng batch bằng Gemini.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GeminiRefineDocumentResult {
    pub markdown: String,
    pub model: String,
    pub total_chunks: usize,
    pub refined_chunks: usize,
    pub fallback_chunks: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredAssistantConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownChunk {
    pub body: String,
    pub page_count_estimate: usize,
}

/// Ẩn toàn bộ phần giữa của API key để hiển thị an toàn trong UI/status.
pub fn mask_api_key(key: &str) -> String {
    let trimmed = key.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "••••".to_string();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}••••{tail}")
}

/// Xóa mọi xuất hiện của khóa khỏi chuỗi lỗi/log trước khi trả về caller.
pub fn redact_api_key(message: &str, key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return message.to_string();
    }
    message.replace(trimmed, "[REDACTED_API_KEY]")
}

fn validate_raw_api_key(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(KnitError::InvalidInput(
            "Gemini API key cannot be empty".into(),
        ));
    }
    if trimmed.len() < 16 {
        return Err(KnitError::InvalidInput(
            "Gemini API key appears too short".into(),
        ));
    }
    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\\')
    {
        return Err(KnitError::InvalidInput(
            "Gemini API key contains invalid characters".into(),
        ));
    }
    Ok(trimmed.to_string())
}

fn config_file_path() -> PathBuf {
    app_config_dir().join("ai_assistant.json")
}

fn apply_background_process_flags(cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

fn validate_gemini_model(raw: &str) -> Result<String> {
    let trimmed = raw.trim().strip_prefix("models/").unwrap_or(raw.trim()).trim();
    if trimmed.is_empty() {
        return Err(KnitError::InvalidInput("Gemini model name cannot be empty".into()));
    }
    if trimmed.len() > 120
        || trimmed
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '?' | '#' | '"' | '\''))
    {
        return Err(KnitError::InvalidInput(
            "Gemini model name contains invalid characters".into(),
        ));
    }
    Ok(trimmed.to_string())
}

fn read_config_at(path: &PathBuf) -> Result<StoredAssistantConfig> {
    if !path.exists() {
        return Ok(StoredAssistantConfig::default());
    }
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map_err(|e| KnitError::InvalidInput(format!("Invalid AI assistant config: {e}")))
}

fn write_config_at(path: &PathBuf, cfg: &StoredAssistantConfig) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    let json = serde_json::to_vec_pretty(cfg)
        .map_err(|e| KnitError::Internal(format!("Serialize config failed: {e}")))?;
    atomic_write_file(path, |f| {
        f.write_all(&json)?;
        Ok(())
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn read_key_from_config_file_at(path: &PathBuf) -> Result<Option<String>> {
    let parsed = read_config_at(path)?;
    let trimmed = parsed.api_key.trim().to_string();
    if trimmed.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trimmed))
    }
}

fn read_model_from_config_file_at(path: &PathBuf) -> String {
    read_config_at(path)
        .ok()
        .and_then(|c| validate_gemini_model(&c.model).ok())
        .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string())
}

fn read_stored_model() -> String {
    read_model_from_config_file_at(&config_file_path())
}

fn write_key_to_config_file_at(path: &PathBuf, key: &str) -> Result<()> {
    let mut cfg = read_config_at(path).unwrap_or_default();
    cfg.api_key = key.to_string();
    write_config_at(path, &cfg)
}

fn write_model_to_config_file_at(path: &PathBuf, raw_model: &str) -> Result<String> {
    let clean_model = validate_gemini_model(raw_model)?;
    let mut cfg = read_config_at(path).unwrap_or_default();
    cfg.model = clean_model.clone();
    write_config_at(path, &cfg)?;
    Ok(clean_model)
}

fn clear_config_file_at(path: &PathBuf) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let mut cfg = read_config_at(path).unwrap_or_default();
    if cfg.model.trim().is_empty() {
        fs::remove_file(path)?;
    } else {
        cfg.api_key.clear();
        write_config_at(path, &cfg)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn try_secret_tool_lookup() -> Option<String> {
    let mut cmd = Command::new("secret-tool");
    cmd.args(["lookup", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT]);
    let output = cmd.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

#[cfg(not(target_os = "linux"))]
fn try_secret_tool_lookup() -> Option<String> {
    None
}

#[cfg(target_os = "linux")]
fn try_secret_tool_store(key: &str) -> bool {
    let mut cmd = Command::new("secret-tool");
    cmd.args([
        "store",
        "--label=Knit Gemini API Key",
        "service",
        KEYCHAIN_SERVICE,
        "account",
        KEYCHAIN_ACCOUNT,
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::null())
    .stderr(Stdio::null());
    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(key.as_bytes());
    }
    child.wait().map(|s| s.success()).unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn try_secret_tool_store(_key: &str) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn try_secret_tool_clear() {
    let mut cmd = Command::new("secret-tool");
    cmd.args(["clear", "service", KEYCHAIN_SERVICE, "account", KEYCHAIN_ACCOUNT]);
    let _ = cmd.output();
}

#[cfg(not(target_os = "linux"))]
fn try_secret_tool_clear() {}

fn load_gemini_key_with_backend() -> Result<Option<(String, String)>> {
    if let Some(key) = try_secret_tool_lookup() {
        return Ok(Some((key, "keychain".to_string())));
    }
    if let Some(key) = read_key_from_config_file_at(&config_file_path())? {
        return Ok(Some((key, "config_file".to_string())));
    }
    Ok(None)
}

/// Lấy trạng thái cấu hình Gemini API Key (đã che khóa).
pub fn get_gemini_key_status() -> Result<GeminiKeyStatus> {
    let model = read_stored_model();
    match load_gemini_key_with_backend()? {
        Some((key, backend)) => Ok(GeminiKeyStatus {
            configured: true,
            masked_key: Some(mask_api_key(&key)),
            storage_backend: backend,
            model,
        }),
        None => Ok(GeminiKeyStatus {
            configured: false,
            masked_key: None,
            storage_backend: "none".to_string(),
            model,
        }),
    }
}

/// Lưu Gemini API Key vào OS keychain (nếu sẵn sàng) hoặc file cấu hình phân quyền 0600.
pub fn save_gemini_key(raw_key: &str) -> Result<GeminiKeyStatus> {
    let key = validate_raw_api_key(raw_key)?;
    let cfg_path = config_file_path();
    let model = read_stored_model();

    if try_secret_tool_store(&key) {
        let _ = clear_config_file_at(&cfg_path);
        return Ok(GeminiKeyStatus {
            configured: true,
            masked_key: Some(mask_api_key(&key)),
            storage_backend: "keychain".to_string(),
            model,
        });
    }

    write_key_to_config_file_at(&cfg_path, &key)?;
    Ok(GeminiKeyStatus {
        configured: true,
        masked_key: Some(mask_api_key(&key)),
        storage_backend: "config_file".to_string(),
        model,
    })
}

/// Lưu tên model Gemini ưa thích vào file cấu hình nội bộ.
pub fn save_gemini_model(raw_model: &str) -> Result<GeminiKeyStatus> {
    write_model_to_config_file_at(&config_file_path(), raw_model)?;
    get_gemini_key_status()
}

/// Xóa Gemini API Key khỏi cả OS keychain lẫn file cấu hình.
pub fn clear_gemini_key() -> Result<GeminiKeyStatus> {
    try_secret_tool_clear();
    clear_config_file_at(&config_file_path())?;
    Ok(GeminiKeyStatus {
        configured: false,
        masked_key: None,
        storage_backend: "none".to_string(),
        model: read_stored_model(),
    })
}

/// Kiểm tra kết nối tới Gemini API bằng khóa đã lưu hoặc một khóa tạm truyền trực tiếp để test.
pub fn test_gemini_connection(
    candidate_key: Option<&str>,
    candidate_model: Option<&str>,
) -> Result<GeminiKeyStatus> {
    let (key, backend) = match candidate_key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => (validate_raw_api_key(raw)?, "unsaved_input".to_string()),
        None => load_gemini_key_with_backend()?.ok_or_else(|| {
            KnitError::InvalidInput("Gemini API key is not configured yet".into())
        })?,
    };
    let model = match candidate_model.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw_m) => validate_gemini_model(raw_m)?,
        None => read_stored_model(),
    };

    let payload = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [{"text": "Reply with OK."}]
        }],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 16
        }
    });
    let body = serde_json::to_string(&payload)
        .map_err(|e| KnitError::Internal(format!("JSON build failed: {e}")))?;

    let response = execute_gemini_curl(&key, &model, &body)?;
    let _ = parse_gemini_candidate_text(&response, &key)?;

    if candidate_model.map(str::trim).is_some_and(|s| !s.is_empty()) {
        let _ = write_model_to_config_file_at(&config_file_path(), &model);
    }

    Ok(GeminiKeyStatus {
        configured: backend != "unsaved_input",
        masked_key: Some(mask_api_key(&key)),
        storage_backend: backend,
        model,
    })
}

/// Lấy danh sách các model Gemini hỗ trợ `generateContent` từ API bằng khóa hiện có.
pub fn list_gemini_models(candidate_key: Option<&str>) -> Result<Vec<String>> {
    let key = match candidate_key.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => validate_raw_api_key(raw)?,
        None => load_gemini_key_with_backend()?
            .map(|(k, _)| k)
            .ok_or_else(|| KnitError::InvalidInput("Gemini API key is not configured yet".into()))?,
    };

    let resp = execute_gemini_get_curl(
        &key,
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
    )?;
    let val: Value = serde_json::from_str(&resp).map_err(|e| {
        KnitError::Internal(redact_api_key(
            &format!("Invalid Gemini models JSON response: {e}"),
            &key,
        ))
    })?;

    let mut models = Vec::new();
    if let Some(arr) = val.get("models").and_then(|m| m.as_array()) {
        for item in arr {
            let supports_generate = item
                .get("supportedGenerationMethods")
                .and_then(|m| m.as_array())
                .is_some_and(|methods| {
                    methods.iter().any(|v| v.as_str() == Some("generateContent"))
                });
            if !supports_generate {
                continue;
            }
            if let Some(raw_name) = item.get("name").and_then(|n| n.as_str()) {
                let clean = raw_name.strip_prefix("models/").unwrap_or(raw_name).trim();
                if clean.starts_with("gemini-") && !models.iter().any(|m| m == clean) {
                    models.push(clean.to_string());
                }
            }
        }
    }

    for preset in DEFAULT_GEMINI_MODELS {
        if !models.iter().any(|m| m == preset) {
            models.push((*preset).to_string());
        }
    }
    Ok(models)
}

/// Chia Markdown thành các batch 3–5 trang dựa theo marker `<!-- page: N -->`, hoặc chia theo đoạn nếu không có marker.
pub fn split_markdown_into_page_chunks(
    markdown: &str,
    pages_per_chunk: usize,
    max_chars_per_chunk: usize,
) -> Vec<MarkdownChunk> {
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let pages_cap = pages_per_chunk.clamp(1, 5);
    let chars_cap = max_chars_per_chunk.max(1500);

    // Tách theo ranh giới `<!-- page: N -->` trước
    let mut page_segments: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut saw_marker = false;

    for line in markdown.lines() {
        let is_marker = {
            let t = line.trim();
            t.starts_with("<!-- page:") && t.ends_with("-->")
        };
        if is_marker {
            saw_marker = true;
            if !cur.trim().is_empty() {
                page_segments.push(cur.trim().to_string());
                cur.clear();
            }
        }
        cur.push_str(line);
        cur.push('\n');
    }
    if !cur.trim().is_empty() {
        page_segments.push(cur.trim().to_string());
    }

    if saw_marker && !page_segments.is_empty() {
        let mut chunks = Vec::new();
        let mut buf = String::new();
        let mut pages_in_buf = 0usize;

        for seg in page_segments {
            let next_len = buf.len() + seg.len() + 2;
            if !buf.is_empty() && (pages_in_buf >= pages_cap || next_len > chars_cap) {
                chunks.push(MarkdownChunk {
                    body: buf.trim().to_string(),
                    page_count_estimate: pages_in_buf.max(1),
                });
                buf.clear();
                pages_in_buf = 0;
            }
            if !buf.is_empty() {
                buf.push_str("\n\n");
            }
            buf.push_str(&seg);
            pages_in_buf += 1;
        }
        if !buf.is_empty() {
            chunks.push(MarkdownChunk {
                body: buf.trim().to_string(),
                page_count_estimate: pages_in_buf.max(1),
            });
        }
        return chunks;
    }

    // Fallback: tách theo đoạn rỗng nếu user xóa marker hoặc chỉ chọn một vùng văn bản
    let mut chunks = Vec::new();
    let mut buf = String::new();
    for para in markdown.split("\n\n") {
        let p = para.trim();
        if p.is_empty() {
            continue;
        }
        if !buf.is_empty() && buf.len() + p.len() + 2 > chars_cap {
            chunks.push(MarkdownChunk {
                body: buf.trim().to_string(),
                page_count_estimate: 1,
            });
            buf.clear();
        }
        if !buf.is_empty() {
            buf.push_str("\n\n");
        }
        buf.push_str(p);
    }
    if !buf.is_empty() {
        chunks.push(MarkdownChunk {
            body: buf.trim().to_string(),
            page_count_estimate: 1,
        });
    }
    chunks
}

/// Kiểm tra đầu ra Gemini không bị trống, không bị cắt ngắn (<55%), không bịa thêm quá mức và giữ nguyên link ảnh.
pub fn validate_refined_markdown_sanity(
    original: &str,
    candidate_raw: &str,
) -> std::result::Result<String, String> {
    let cleaned = unwrap_outer_markdown_fence(candidate_raw).trim().to_string();
    if cleaned.is_empty() {
        return Err("Gemini returned empty output".to_string());
    }

    let orig_non_ws = original.chars().filter(|c| !c.is_whitespace()).count();
    let cand_non_ws = cleaned.chars().filter(|c| !c.is_whitespace()).count();

    if orig_non_ws >= 120 && cand_non_ws * 100 < orig_non_ws * 55 {
        return Err(format!(
            "Output truncated too aggressively ({cand_non_ws} vs {orig_non_ws} chars)"
        ));
    }
    if orig_non_ws >= 80 && cand_non_ws > orig_non_ws * 3 {
        return Err("Output expanded unexpectedly".to_string());
    }

    for img_target in extract_markdown_image_targets(original) {
        if !cleaned.contains(&img_target) {
            return Err(format!(
                "Missing original image link '{img_target}' in Gemini output"
            ));
        }
    }

    Ok(nfc_normalize(&cleaned))
}

fn unwrap_outer_markdown_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let lines: Vec<&str> = trimmed.lines().collect();
    if lines.len() >= 3 && lines.last().is_some_and(|l| l.trim() == "```") {
        let first = lines[0].trim();
        if first == "```" || first.eq_ignore_ascii_case("```markdown") || first.eq_ignore_ascii_case("```md") {
            return lines[1..lines.len() - 1].join("\n");
        }
    }
    trimmed.to_string()
}

fn extract_markdown_image_targets(md: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut search_from = 0usize;
    while let Some(rel) = md[search_from..].find("![") {
        let start = search_from + rel;
        if let Some(alt_close) = md[start..].find("](") {
            let url_start = start + alt_close + 2;
            if let Some(url_close) = md[url_start..].find(')') {
                let target = md[url_start..url_start + url_close].trim();
                if !target.is_empty() {
                    targets.push(target.to_string());
                }
                search_from = url_start + url_close + 1;
                continue;
            }
        }
        search_from = start + 2;
    }
    targets
}

/// Tinh chỉnh Markdown theo yêu cầu bằng khóa Gemini đã cấu hình (fallback tự động từng chunk nếu lỗi).
pub fn refine_markdown_with_gemini(
    markdown: &str,
    user_instruction: Option<&str>,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<GeminiRefineDocumentResult> {
    let (key, _) = load_gemini_key_with_backend()?.ok_or_else(|| {
        KnitError::InvalidInput("Gemini API key is not configured".into())
    })?;
    let active_model = read_stored_model();
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);

    refine_markdown_with_gemini_using(
        markdown,
        user_instruction,
        &active_model,
        cancel,
        rep,
        |prompt| {
            let body = build_gemini_request_body(prompt)?;
            let raw = execute_gemini_curl(&key, &active_model, &body)?;
            parse_gemini_candidate_text(&raw, &key)
        },
        &key,
    )
}

fn is_fatal_gemini_api_error(message: &str) -> bool {
    message.contains("HTTP 400")
        || message.contains("HTTP 401")
        || message.contains("HTTP 403")
        || message.contains("HTTP 404")
        || message.contains("API key not valid")
        || message.contains("is no longer available")
        || message.contains("not found for API version")
}

pub fn refine_markdown_with_gemini_using<F>(
    markdown: &str,
    user_instruction: Option<&str>,
    model: &str,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
    mut transport: F,
    secret_to_redact: &str,
) -> Result<GeminiRefineDocumentResult>
where
    F: FnMut(&str) -> Result<String>,
{
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let chunks = split_markdown_into_page_chunks(markdown, 4, 10_000);
    if chunks.is_empty() {
        return Ok(GeminiRefineDocumentResult {
            markdown: nfc_normalize(markdown),
            model: model.to_string(),
            total_chunks: 0,
            refined_chunks: 0,
            fallback_chunks: 0,
            warnings: Vec::new(),
        });
    }

    let total_chunks = chunks.len();
    let mut output_chunks = Vec::with_capacity(total_chunks);
    let mut refined_chunks = 0usize;
    let mut fallback_chunks = 0usize;
    let mut transport_errors = 0usize;
    let mut warnings = Vec::new();
    let extra_note = user_instruction
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("");

    for (idx, chunk) in chunks.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }

        let prompt = build_refine_prompt(&chunk.body, extra_note);
        match transport(&prompt) {
            Ok(candidate) => match validate_refined_markdown_sanity(&chunk.body, &candidate) {
                Ok(validated) => {
                    refined_chunks += 1;
                    output_chunks.push(validated);
                }
                Err(reason) => {
                    fallback_chunks += 1;
                    warnings.push(format!(
                        "Chunk {}/{}: {} — kept offline Markdown.",
                        idx + 1,
                        total_chunks,
                        redact_api_key(&reason, secret_to_redact)
                    ));
                    output_chunks.push(chunk.body.clone());
                }
            },
            Err(KnitError::Cancelled) => return Err(KnitError::Cancelled),
            Err(err) => {
                let redacted = redact_api_key(&err.to_string(), secret_to_redact);
                if is_fatal_gemini_api_error(&redacted) {
                    return Err(KnitError::Internal(redacted));
                }
                transport_errors += 1;
                fallback_chunks += 1;
                warnings.push(format!(
                    "Chunk {}/{}: {} — kept offline Markdown.",
                    idx + 1,
                    total_chunks,
                    redacted
                ));
                output_chunks.push(chunk.body.clone());
            }
        }

        reporter.on_progress(JobProgress {
            phase: "gemini".into(),
            done: (idx + 1) as u64,
            total: total_chunks as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Refined chunk {}/{}", idx + 1, total_chunks),
        });
    }

    if refined_chunks == 0 && transport_errors > 0 {
        let detail = warnings
            .first()
            .cloned()
            .unwrap_or_else(|| "Gemini refinement failed for all chunks".to_string());
        return Err(KnitError::Internal(detail));
    }

    let joined = nfc_normalize(&output_chunks.join("\n\n"));
    Ok(GeminiRefineDocumentResult {
        markdown: joined,
        model: model.to_string(),
        total_chunks,
        refined_chunks,
        fallback_chunks,
        warnings,
    })
}

fn build_refine_prompt(chunk_markdown: &str, extra_instruction: &str) -> String {
    let mut prompt = String::from(
        "You are an editorial formatter cleaning up PDF-extracted GitHub-Flavored Markdown.\n\
         Rules:\n\
         1. Fix broken line wraps, accidental spaces, broken lists, and misaligned tables.\n\
         2. Preserve ALL factual content, numbers, names, dates, code, headings, and Vietnamese diacritics exactly.\n\
         3. Keep EVERY `<!-- page: N -->` comment and EVERY `![...](...)` image link completely unchanged.\n\
         4. Do NOT summarize, shorten, translate, or wrap your entire output in outer markdown code fences.\n",
    );
    if !extra_instruction.is_empty() {
        prompt.push_str("Additional instruction: ");
        prompt.push_str(extra_instruction);
        prompt.push('\n');
    }
    prompt.push_str("\nInput Markdown:\n\n");
    prompt.push_str(chunk_markdown);
    prompt
}

fn build_gemini_request_body(prompt: &str) -> Result<String> {
    let payload = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": 0.1
        }
    });
    serde_json::to_string(&payload)
        .map_err(|e| KnitError::Internal(format!("Failed to build Gemini payload: {e}")))
}

fn run_gemini_curl_request(api_key: &str, curl_config: &str) -> Result<String> {
    let mut cmd = Command::new("curl");
    cmd.args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_background_process_flags(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        KnitError::Internal(redact_api_key(
            &format!("Failed to start curl for Gemini request: {e}"),
            api_key,
        ))
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(curl_config.as_bytes()).map_err(|e| {
            KnitError::Internal(redact_api_key(&format!("Failed writing curl stdin: {e}"), api_key))
        })?;
    }

    let output = child.wait_with_output().map_err(|e| {
        KnitError::Internal(redact_api_key(&format!("Gemini HTTP transport error: {e}"), api_key))
    })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        let msg = if stderr.trim().is_empty() {
            "Gemini network request failed".to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(KnitError::Internal(redact_api_key(&msg, api_key)));
    }

    let (resp_body, status_code) = match stdout.rsplit_once("\n__KNIT_HTTP_STATUS__:") {
        Some((b, code)) => (b, code.trim().parse::<u16>().unwrap_or(0)),
        None => (stdout.as_ref(), 200u16),
    };

    if status_code >= 400 {
        let api_err = extract_gemini_error_message(resp_body);
        let mapped = match status_code {
            401 | 403 => format!("Gemini API key rejected (HTTP {status_code}): {api_err}"),
            429 => format!("Gemini API rate limit exceeded (HTTP 429): {api_err}"),
            _ => format!("Gemini API error (HTTP {status_code}): {api_err}"),
        };
        return Err(KnitError::Internal(redact_api_key(&mapped, api_key)));
    }

    Ok(resp_body.to_string())
}

fn execute_gemini_get_curl(api_key: &str, url: &str) -> Result<String> {
    let curl_config = format!(
        "url = \"{url}\"\n\
         header = \"x-goog-api-key: {api_key}\"\n\
         silent\n\
         show-error\n\
         location\n\
         max-time = 25\n\
         write-out = \"\\n__KNIT_HTTP_STATUS__:%{{http_code}}\"\n"
    );
    run_gemini_curl_request(api_key, &curl_config)
}

fn execute_gemini_curl(api_key: &str, model: &str, request_json: &str) -> Result<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    );
    let mut body_file = NamedTempFile::new()?;
    body_file.write_all(request_json.as_bytes())?;
    body_file.flush()?;
    let body_path = body_file.path().to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");

    // Truyền header x-goog-api-key qua stdin (`--config -`) để không lộ khóa trong danh sách tiến trình OS.
    let curl_config = format!(
        "url = \"{url}\"\n\
         header = \"Content-Type: application/json\"\n\
         header = \"x-goog-api-key: {api_key}\"\n\
         data-binary = \"@{body_path}\"\n\
         silent\n\
         show-error\n\
         location\n\
         max-time = 45\n\
         write-out = \"\\n__KNIT_HTTP_STATUS__:%{{http_code}}\"\n"
    );

    run_gemini_curl_request(api_key, &curl_config)
}

fn extract_gemini_error_message(resp_body: &str) -> String {
    serde_json::from_str::<Value>(resp_body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "Unexpected response from Gemini API".to_string())
}

fn parse_gemini_candidate_text(resp_body: &str, api_key: &str) -> Result<String> {
    let val: Value = serde_json::from_str(resp_body).map_err(|e| {
        KnitError::Internal(redact_api_key(&format!("Invalid Gemini JSON response: {e}"), api_key))
    })?;

    if let Some(err_msg) = val
        .get("error")
        .and_then(|e| e.get("message"))
        .and_then(|m| m.as_str())
    {
        return Err(KnitError::Internal(redact_api_key(err_msg, api_key)));
    }

    let candidate = val
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| KnitError::Internal("Gemini returned no candidate content".into()))?;

    if let Some(finish) = candidate.get("finishReason").and_then(|f| f.as_str()) {
        if matches!(
            finish,
            "SAFETY" | "RECITATION" | "MAX_TOKENS" | "PROHIBITED_CONTENT" | "BLOCKLIST"
        ) {
            return Err(KnitError::Internal(format!(
                "Gemini stopped with finishReason={finish}"
            )));
        }
    }

    let parts = candidate
        .get("content")
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .ok_or_else(|| KnitError::Internal("Gemini candidate contained no parts".into()))?;

    let mut out = String::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
            out.push_str(text);
        }
    }
    if out.trim().is_empty() {
        return Err(KnitError::Internal("Gemini response text was empty".into()));
    }
    Ok(out)
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn config_file_roundtrip_and_redaction() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("ai_assistant.json");
        let fake_key = "AIzaTestFakeKey1234567890ABCD";
        write_key_to_config_file_at(&path, fake_key).unwrap();
        assert_eq!(
            read_key_from_config_file_at(&path).unwrap().as_deref(),
            Some(fake_key)
        );
        assert_eq!(mask_api_key(fake_key), "AIza••••ABCD");
        assert!(!redact_api_key(&format!("err {fake_key}"), fake_key).contains(fake_key));
        write_model_to_config_file_at(&path, "models/gemini-2.5-pro").unwrap();
        assert_eq!(read_model_from_config_file_at(&path), "gemini-2.5-pro");
        clear_config_file_at(&path).unwrap();
        assert!(read_key_from_config_file_at(&path).unwrap().is_none());
        assert_eq!(read_model_from_config_file_at(&path), "gemini-2.5-pro");
    }
}
