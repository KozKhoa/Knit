use crate::models::{DocConvertOptions, HtmlStepKind};
use crate::office::{detect_chromium_browser, path_to_file_uri, write_html_temp_for_browser};
use base64::Engine as _;
use knit_core::{CancellationToken, KnitError, Result};
use lopdf::{Dictionary, Document, Object, ObjectId};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const MAX_SLIDE_STEPS: usize = 250;
const SLIDE_CAPTURE_DEADLINE_SECS: u64 = 90;

struct ChildProcessGuard(Option<Child>);

impl ChildProcessGuard {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        match self.0.as_mut() {
            Some(c) => c.try_wait(),
            None => Ok(None),
        }
    }

    fn shutdown(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for ChildProcessGuard {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Kiểm tra heuristic xem tệp HTML có phải là bản trình chiếu tương tác bằng bàn phím (`Space` / mũi tên) hay không.
pub fn should_use_slide_step_auto(raw_html: &str) -> bool {
    let lower = raw_html.to_ascii_lowercase();
    let has_slide_container = lower.contains("class=\"slide")
        || lower.contains("class='slide")
        || lower.contains("deck-stage")
        || lower.contains("remark-slides-area")
        || (lower.contains("class=\"reveal") && lower.contains("class=\"slides"))
        || lower.contains("reveal.initialize")
        || lower.contains("impress()");

    if !has_slide_container {
        return false;
    }

    let has_key_nav = lower.contains("arrowright")
        || lower.contains("pagedown")
        || lower.contains("slidepresentation")
        || lower.contains("reveal.initialize")
        || lower.contains("remark.create")
        || (lower.contains("keydown") && (lower.contains("space") || lower.contains("nextslide")));

    has_key_nav
}

fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &b in bytes {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn simple_nonce_16() -> [u8; 16] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0x1234_5678_9abc_def0);
    let pid = u128::from(std::process::id());
    let mixed = nanos ^ (pid.rotate_left(37));
    mixed.to_le_bytes()
}

fn simple_mask_4(counter: u64) -> [u8; 4] {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e37_79b9_7f4a_7c15);
    let val = (nanos ^ counter.wrapping_mul(0x9e37_79b9_7f4a_7c15)) as u32;
    val.to_be_bytes()
}

struct WsUri {
    host: String,
    port: u16,
    path: String,
}

fn parse_ws_uri(uri: &str) -> Result<WsUri> {
    let rest = uri
        .strip_prefix("ws://")
        .ok_or_else(|| KnitError::Internal(format!("Unsupported CDP WebSocket URI: {uri}")))?;
    let (host_port, path_part) = match rest.find('/') {
        Some(idx) => (&rest[..idx], &rest[idx..]),
        None => (rest, "/"),
    };
    let (host, port_str) = host_port
        .rsplit_once(':')
        .ok_or_else(|| KnitError::Internal(format!("Missing port in CDP URI: {uri}")))?;
    let port: u16 = port_str
        .parse()
        .map_err(|_| KnitError::Internal(format!("Invalid port in CDP URI: {uri}")))?;
    Ok(WsUri {
        host: host.to_string(),
        port,
        path: path_part.to_string(),
    })
}

/// Client WebSocket tối giản chuẩn RFC 6455 dành riêng cho kết nối CDP cục bộ (`127.0.0.1`).
struct LocalWebSocket {
    stream: TcpStream,
    mask_counter: u64,
}

impl LocalWebSocket {
    fn connect(ws_uri: &str) -> Result<Self> {
        let parsed = parse_ws_uri(ws_uri)?;
        let mut stream = TcpStream::connect((parsed.host.as_str(), parsed.port))
            .map_err(|e| KnitError::Internal(format!("Cannot connect to Chrome DevTools: {e}")))?;
        stream.set_read_timeout(Some(Duration::from_millis(250)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;

        let key = base64::engine::general_purpose::STANDARD.encode(simple_nonce_16());
        let req = format!(
            "GET {} HTTP/1.1\r\nHost: {}:{}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {}\r\nSec-WebSocket-Version: 13\r\n\r\n",
            parsed.path, parsed.host, parsed.port, key
        );
        stream.write_all(req.as_bytes())?;
        stream.flush()?;

        let mut hdr_buf = Vec::with_capacity(1024);
        let mut byte = [0u8; 1];
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            match stream.read(&mut byte) {
                Ok(0) => {
                    return Err(KnitError::Internal(
                        "Chrome DevTools closed connection during WebSocket handshake".into(),
                    ))
                }
                Ok(_) => {
                    hdr_buf.push(byte[0]);
                    if hdr_buf.ends_with(b"\r\n\r\n") {
                        break;
                    }
                    if hdr_buf.len() > 16384 {
                        return Err(KnitError::Internal("WebSocket handshake header too large".into()));
                    }
                }
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                    ) =>
                {
                    continue
                }
                Err(e) => return Err(e.into()),
            }
        }

        let hdr_str = String::from_utf8_lossy(&hdr_buf);
        if !hdr_str.starts_with("HTTP/1.1 101") && !hdr_str.starts_with("HTTP/1.0 101") {
            return Err(KnitError::Internal(format!(
                "Chrome DevTools WebSocket upgrade failed: {}",
                hdr_str.lines().next().unwrap_or("")
            )));
        }

        Ok(Self {
            stream,
            mask_counter: 1,
        })
    }

    fn write_frame(&mut self, opcode: u8, payload: &[u8]) -> Result<()> {
        self.mask_counter = self.mask_counter.wrapping_add(1);
        let mask = simple_mask_4(self.mask_counter);
        let mut header = Vec::with_capacity(14);
        header.push(0x80 | (opcode & 0x0F));
        let len = payload.len();
        if len < 126 {
            header.push(0x80 | (len as u8));
        } else if len <= u16::MAX as usize {
            header.push(0x80 | 126);
            header.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            header.push(0x80 | 127);
            header.extend_from_slice(&(len as u64).to_be_bytes());
        }
        header.extend_from_slice(&mask);
        self.stream.write_all(&header)?;

        let mut masked = Vec::with_capacity(len);
        for (idx, &b) in payload.iter().enumerate() {
            masked.push(b ^ mask[idx % 4]);
        }
        self.stream.write_all(&masked)?;
        self.stream.flush()?;
        Ok(())
    }

    fn send_text(&mut self, text: &str) -> Result<()> {
        self.write_frame(0x1, text.as_bytes())
    }

    fn read_exact_cancellable(
        &mut self,
        len: usize,
        cancel: &CancellationToken,
        deadline: Instant,
    ) -> Result<Vec<u8>> {
        let mut out = vec![0u8; len];
        let mut read = 0usize;
        while read < len {
            if cancel.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
            if Instant::now() > deadline {
                return Err(KnitError::Internal(
                    "Timed out waiting for Chrome DevTools response".into(),
                ));
            }
            match self.stream.read(&mut out[read..]) {
                Ok(0) => {
                    return Err(KnitError::Internal(
                        "Chrome DevTools WebSocket closed unexpectedly".into(),
                    ))
                }
                Ok(n) => read += n,
                Err(e)
                    if matches!(
                        e.kind(),
                        ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted
                    ) =>
                {
                    continue
                }
                Err(e) => return Err(e.into()),
            }
        }
        Ok(out)
    }

    fn recv_text(&mut self, cancel: &CancellationToken, timeout: Duration) -> Result<String> {
        let deadline = Instant::now() + timeout;
        let mut fragmented: Vec<u8> = Vec::new();
        let mut in_text_fragment = false;

        loop {
            let hdr = self.read_exact_cancellable(2, cancel, deadline)?;
            let fin = (hdr[0] & 0x80) != 0;
            let opcode = hdr[0] & 0x0F;
            let masked = (hdr[1] & 0x80) != 0;
            let mut payload_len = (hdr[1] & 0x7F) as usize;
            if payload_len == 126 {
                let ext = self.read_exact_cancellable(2, cancel, deadline)?;
                payload_len = u16::from_be_bytes([ext[0], ext[1]]) as usize;
            } else if payload_len == 127 {
                let ext = self.read_exact_cancellable(8, cancel, deadline)?;
                payload_len = u64::from_be_bytes([
                    ext[0], ext[1], ext[2], ext[3], ext[4], ext[5], ext[6], ext[7],
                ]) as usize;
            }
            let mask_key = if masked {
                Some(self.read_exact_cancellable(4, cancel, deadline)?)
            } else {
                None
            };
            let mut payload = self.read_exact_cancellable(payload_len, cancel, deadline)?;
            if let Some(mask) = mask_key {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= mask[i % 4];
                }
            }

            match opcode {
                0x8 => {
                    return Err(KnitError::Internal("Chrome DevTools closed WebSocket".into()));
                }
                0x9 => {
                    let _ = self.write_frame(0xA, &payload);
                }
                0xA => {}
                0x1 => {
                    if fin {
                        return String::from_utf8(payload).map_err(|e| {
                            KnitError::Internal(format!("Invalid UTF-8 from CDP: {e}"))
                        });
                    }
                    fragmented.clear();
                    fragmented.extend_from_slice(&payload);
                    in_text_fragment = true;
                }
                0x0 if in_text_fragment => {
                    fragmented.extend_from_slice(&payload);
                    if fin {
                        let out = std::mem::take(&mut fragmented);
                        return String::from_utf8(out).map_err(|e| {
                            KnitError::Internal(format!("Invalid UTF-8 from CDP: {e}"))
                        });
                    }
                }
                _ => {}
            }
        }
    }

    fn cdp_call(
        &mut self,
        next_id: &mut u64,
        method: &str,
        params: Value,
        cancel: &CancellationToken,
        timeout: Duration,
    ) -> Result<Value> {
        *next_id += 1;
        let call_id = *next_id;
        let req = json!({
            "id": call_id,
            "method": method,
            "params": params,
        });
        self.send_text(&req.to_string())?;

        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(KnitError::Internal(format!("CDP call timed out: {method}")));
            }
            let raw = self.recv_text(cancel, remaining)?;
            let parsed: Value = serde_json::from_str(&raw).map_err(|e| {
                KnitError::Internal(format!("Malformed JSON response from Chrome DevTools: {e}"))
            })?;
            if parsed.get("id").and_then(|v| v.as_u64()) == Some(call_id) {
                if let Some(err) = parsed.get("error") {
                    return Err(KnitError::Internal(format!("CDP error in {method}: {err}")));
                }
                return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    }
}

fn read_retry_eintr(stream: &mut TcpStream, buf: &mut [u8]) -> std::io::Result<usize> {
    loop {
        match stream.read(buf) {
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            res => return res,
        }
    }
}

fn http_get_local(port: u16, path: &str) -> Result<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(3)))?;
    let req = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(req.as_bytes())?;
    stream.flush()?;

    let mut raw = Vec::with_capacity(2048);
    let mut buf = [0u8; 2048];
    let header_end = loop {
        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            break pos;
        }
        let n = read_retry_eintr(&mut stream, &mut buf)?;
        if n == 0 {
            return Err(KnitError::Internal(
                "Chrome DevTools HTTP endpoint closed before sending headers".into(),
            ));
        }
        raw.extend_from_slice(&buf[..n]);
        if raw.len() > 65536 {
            return Err(KnitError::Internal("HTTP response headers too large".into()));
        }
    };

    let headers_str = String::from_utf8_lossy(&raw[..header_end]);
    let content_len = headers_str
        .lines()
        .find_map(|line| {
            let (name, val) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                val.trim().parse::<usize>().ok()
            } else {
                None
            }
        });

    let body_start = header_end + 4;
    if let Some(expected_len) = content_len {
        while raw.len().saturating_sub(body_start) < expected_len {
            let n = read_retry_eintr(&mut stream, &mut buf)?;
            if n == 0 {
                break;
            }
            raw.extend_from_slice(&buf[..n]);
        }
        let end = (body_start + expected_len).min(raw.len());
        return Ok(String::from_utf8_lossy(&raw[body_start..end]).into_owned());
    }

    loop {
        match read_retry_eintr(&mut stream, &mut buf) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => break,
            Err(e) => return Err(e.into()),
        }
    }
    Ok(String::from_utf8_lossy(&raw[body_start..]).into_owned())
}

fn find_page_ws_url(port: u16, cancel: &CancellationToken) -> Result<String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if let Ok(body) = http_get_local(port, "/json/list") {
            if let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&body) {
                if let Some(ws) = items
                    .iter()
                    .find(|item| item.get("type").and_then(|t| t.as_str()) == Some("page"))
                    .and_then(|item| item.get("webSocketDebuggerUrl").and_then(|u| u.as_str()))
                {
                    return Ok(ws.to_string());
                }
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err(KnitError::Internal(
        "Chrome DevTools page target did not become ready".into(),
    ))
}

fn wait_for_devtools_port(
    user_data_dir: &Path,
    child: &mut ChildProcessGuard,
    cancel: &CancellationToken,
) -> Result<u16> {
    let port_file = user_data_dir.join("DevToolsActivePort");
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(KnitError::Internal(format!(
                "Headless Chromium exited early ({status})"
            )));
        }
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            if let Some(first_line) = content.lines().next() {
                if let Ok(port) = first_line.trim().parse::<u16>() {
                    if port > 0 {
                        return Ok(port);
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    Err(KnitError::Internal(
        "Timed out waiting for Chrome DevToolsActivePort".into(),
    ))
}

fn materialize_inherited_page_attrs(doc: &mut Document, page_id: ObjectId) -> Result<()> {
    let mut inherited: Vec<(&[u8], Object)> = Vec::new();
    let mut curr_id = page_id;
    let mut depth = 0usize;
    while depth < 16 {
        depth += 1;
        let Ok(dict) = doc.get_dictionary(curr_id) else {
            break;
        };
        if curr_id != page_id {
            for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"] {
                if let Ok(val) = dict.get(key) {
                    if !inherited.iter().any(|(k, _)| *k == key) {
                        inherited.push((key, val.clone()));
                    }
                }
            }
        }
        let Ok(parent_ref) = dict.get(b"Parent").and_then(|o| o.as_reference()) else {
            break;
        };
        curr_id = parent_ref;
    }

    if let Ok(Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
        for (key, val) in inherited {
            if page_dict.get(key).is_err() {
                page_dict.set(key, val);
            }
        }
    }
    Ok(())
}

/// Ghép danh sách các PDF 1-trang thu được từ từng bước slide thành 1 tài liệu PDF hoàn chỉnh.
pub fn merge_pdf_documents_mem(pdf_chunks: &[Vec<u8>]) -> Result<Vec<u8>> {
    if pdf_chunks.is_empty() {
        return Err(KnitError::InvalidInput("No slide PDF pages to merge".into()));
    }
    if pdf_chunks.len() == 1 {
        return Ok(pdf_chunks[0].clone());
    }

    let mut max_id = 1u32;
    let mut page_entries: Vec<(ObjectId, Object)> = Vec::with_capacity(pdf_chunks.len());
    let mut merged = Document::with_version("1.5");
    let mut first_info_obj: Option<Object> = None;

    for chunk in pdf_chunks {
        let mut doc = Document::load_mem(chunk).map_err(|e| {
            KnitError::Internal(format!("Failed to parse captured slide PDF chunk: {e}"))
        })?;
        let raw_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        for &pid in &raw_pages {
            materialize_inherited_page_attrs(&mut doc, pid)?;
        }

        doc.renumber_objects_with(max_id);
        max_id = doc.max_id + 1;

        if first_info_obj.is_none() {
            if let Ok(info_ref) = doc.trailer.get(b"Info").and_then(|v| v.as_reference()) {
                if let Ok(info) = doc.get_object(info_ref) {
                    first_info_obj = Some(info.clone());
                }
            }
        }

        let renumbered_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        let page_set: HashSet<ObjectId> = renumbered_pages.iter().copied().collect();

        for pid in renumbered_pages {
            if let Ok(obj) = doc.get_object(pid) {
                page_entries.push((pid, obj.clone()));
            }
        }

        for (oid, obj) in doc.objects {
            if page_set.contains(&oid) {
                continue;
            }
            if let Object::Dictionary(ref dict) = obj {
                if let Ok(Object::Name(ref type_name)) = dict.get(b"Type") {
                    if type_name == b"Catalog" || type_name == b"Pages" {
                        continue;
                    }
                }
            }
            merged.objects.insert(oid, obj);
        }
    }

    merged.max_id = max_id;
    let pages_id = merged.new_object_id();
    let mut kids: Vec<Object> = Vec::with_capacity(page_entries.len());

    for (pid, mut page_obj) in page_entries {
        if let Object::Dictionary(ref mut page_dict) = page_obj {
            page_dict.set(b"Parent", Object::Reference(pages_id));
        }
        merged.objects.insert(pid, page_obj);
        kids.push(Object::Reference(pid));
    }

    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", "Pages");
    pages_dict.set("Count", kids.len() as i64);
    pages_dict.set("Kids", kids);
    merged.objects.insert(pages_id, Object::Dictionary(pages_dict));

    let catalog_id = merged.new_object_id();
    let mut catalog_dict = Dictionary::new();
    catalog_dict.set("Type", "Catalog");
    catalog_dict.set("Pages", pages_id);
    merged
        .objects
        .insert(catalog_id, Object::Dictionary(catalog_dict));
    merged.trailer.set("Root", catalog_id);

    if let Some(info_obj) = first_info_obj {
        let info_id = merged.add_object(info_obj);
        merged.trailer.set("Info", info_id);
    }

    let mut out = Vec::new();
    merged
        .save_to(&mut out)
        .map_err(|e| KnitError::Internal(format!("Failed to save merged slide PDF: {e}")))?;
    Ok(out)
}

fn capture_step_state_hash(
    ws: &mut LocalWebSocket,
    next_id: &mut u64,
    cancel: &CancellationToken,
) -> Result<u64> {
    let dom_sig = ws.cdp_call(
        next_id,
        "Runtime.evaluate",
        json!({
            "expression": r#"(() => {
                const active = Array.from(document.querySelectorAll('.slide.active, .slide.visible, .present, .remark-visible, [aria-current="page"], [aria-selected="true"]'))
                    .map(el => el.id + ':' + el.className)
                    .join('|');
                const txt = (document.body ? document.body.innerText : '').slice(0, 600);
                return location.href + '|' + window.scrollX + ',' + window.scrollY + '|' + active + '|' + txt;
            })()"#,
            "returnByValue": true
        }),
        cancel,
        Duration::from_secs(5),
    )?;
    let dom_str = dom_sig
        .pointer("/result/value")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut combined = Vec::with_capacity(dom_str.len() + 4096);
    combined.extend_from_slice(dom_str.as_bytes());

    if let Ok(shot) = ws.cdp_call(
        next_id,
        "Page.captureScreenshot",
        json!({ "format": "png" }),
        cancel,
        Duration::from_secs(8),
    ) {
        if let Some(b64) = shot.get("data").and_then(|v| v.as_str()) {
            combined.push(b'|');
            combined.extend_from_slice(b64.as_bytes());
        }
    }

    Ok(fnv1a_64(&combined))
}

fn resolve_key_spec(raw_key: &str) -> (String, String, u32, Option<String>) {
    let trimmed = raw_key.trim();
    let lower = trimmed.to_ascii_lowercase();
    match lower.as_str() {
        "" | "space" | " " => (" ".into(), "Space".into(), 32, Some(" ".into())),
        "arrowright" | "right" => ("ArrowRight".into(), "ArrowRight".into(), 39, None),
        "arrowleft" | "left" => ("ArrowLeft".into(), "ArrowLeft".into(), 37, None),
        "arrowdown" | "down" => ("ArrowDown".into(), "ArrowDown".into(), 40, None),
        "arrowup" | "up" => ("ArrowUp".into(), "ArrowUp".into(), 38, None),
        "pagedown" | "pgdn" => ("PageDown".into(), "PageDown".into(), 34, None),
        "pageup" | "pgup" => ("PageUp".into(), "PageUp".into(), 33, None),
        "enter" | "return" => ("Enter".into(), "Enter".into(), 13, Some("\r".into())),
        _ => {
            let mut chars = trimmed.chars();
            if let (Some(ch), None) = (chars.next(), chars.next()) {
                let upper = ch.to_ascii_uppercase();
                let code = if upper.is_ascii_alphabetic() {
                    format!("Key{upper}")
                } else if upper.is_ascii_digit() {
                    format!("Digit{upper}")
                } else {
                    trimmed.to_string()
                };
                let vk = upper as u32;
                (ch.to_string(), code, vk, Some(ch.to_string()))
            } else {
                (trimmed.to_string(), trimmed.to_string(), 0, None)
            }
        }
    }
}

fn dispatch_key_event_spec(
    ws: &mut LocalWebSocket,
    next_id: &mut u64,
    key_spec: &str,
    cancel: &CancellationToken,
) -> Result<()> {
    let _ = ws.cdp_call(
        next_id,
        "Runtime.evaluate",
        json!({
            "expression": "(() => { if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur(); })()"
        }),
        cancel,
        Duration::from_secs(3),
    );

    let (key, code, vk, char_text) = resolve_key_spec(key_spec);

    ws.cdp_call(
        next_id,
        "Input.dispatchKeyEvent",
        json!({
            "type": "rawKeyDown",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk
        }),
        cancel,
        Duration::from_secs(5),
    )?;
    if let Some(txt) = char_text {
        ws.cdp_call(
            next_id,
            "Input.dispatchKeyEvent",
            json!({ "type": "char", "text": txt }),
            cancel,
            Duration::from_secs(5),
        )?;
    }
    ws.cdp_call(
        next_id,
        "Input.dispatchKeyEvent",
        json!({
            "type": "keyUp",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk
        }),
        cancel,
        Duration::from_secs(5),
    )?;
    Ok(())
}

fn dispatch_mouse_click_px(
    ws: &mut LocalWebSocket,
    next_id: &mut u64,
    x: f64,
    y: f64,
    cancel: &CancellationToken,
) -> Result<()> {
    ws.cdp_call(
        next_id,
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseMoved", "x": x, "y": y }),
        cancel,
        Duration::from_secs(5),
    )?;
    ws.cdp_call(
        next_id,
        "Input.dispatchMouseEvent",
        json!({ "type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1 }),
        cancel,
        Duration::from_secs(5),
    )?;
    ws.cdp_call(
        next_id,
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1 }),
        cancel,
        Duration::from_secs(5),
    )?;
    Ok(())
}

fn dispatch_click_selector(
    ws: &mut LocalWebSocket,
    next_id: &mut u64,
    selector: &str,
    cancel: &CancellationToken,
) -> Result<bool> {
    let trimmed = selector.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let sel_json = serde_json::to_string(trimmed).unwrap_or_else(|_| "\"\"".to_string());
    let expr = format!(
        r#"(() => {{
            const sel = {sel_json};
            let el = null;
            try {{ el = document.querySelector(sel); }} catch (e) {{ return {{ found: false, invalid: true }}; }}
            if (!el) return {{ found: false }};
            const cs = getComputedStyle(el);
            if (el.disabled || el.getAttribute('aria-disabled') === 'true' || cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') {{
                return {{ found: false }};
            }}
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) {{
                el.click();
                return {{ found: true, clickedDom: true }};
            }}
            return {{ found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }};
        }})()"#
    );
    let res = ws.cdp_call(
        next_id,
        "Runtime.evaluate",
        json!({ "expression": expr, "returnByValue": true }),
        cancel,
        Duration::from_secs(5),
    )?;
    if res.pointer("/result/value/found").and_then(|v| v.as_bool()) != Some(true) {
        return Ok(false);
    }
    if res.pointer("/result/value/clickedDom").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(true);
    }
    let x = res.pointer("/result/value/x").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let y = res.pointer("/result/value/y").and_then(|v| v.as_f64()).unwrap_or(0.0);
    dispatch_mouse_click_px(ws, next_id, x, y, cancel)?;
    Ok(true)
}

fn capture_current_slide_pdf(
    ws: &mut LocalWebSocket,
    next_id: &mut u64,
    width_px: u32,
    height_px: u32,
    cancel: &CancellationToken,
) -> Result<Vec<u8>> {
    let res = ws.cdp_call(
        next_id,
        "Page.printToPDF",
        json!({
            "printBackground": true,
            "paperWidth": f64::from(width_px) / 96.0,
            "paperHeight": f64::from(height_px) / 96.0,
            "marginTop": 0.0,
            "marginBottom": 0.0,
            "marginLeft": 0.0,
            "marginRight": 0.0,
            "preferCSSPageSize": true,
            "pageRanges": "1"
        }),
        cancel,
        Duration::from_secs(15),
    )?;
    let b64 = res
        .get("data")
        .and_then(|v| v.as_str())
        .ok_or_else(|| KnitError::Internal("Chrome Page.printToPDF returned no PDF data".into()))?;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| KnitError::Internal(format!("Invalid base64 PDF from Chrome CDP: {e}")))
}

fn inject_slide_dialog_guard(raw_html: &str) -> String {
    let raw_html = crate::office::sanitize_leading_doctype_junk(raw_html);
    let guard_script = "<script data-knit-print>window.alert=function(){};window.confirm=function(){return true;};window.prompt=function(){return null;};</script>";
    let lower = raw_html.to_ascii_lowercase();
    if let Some(head_start) = lower.find("<head") {
        if let Some(rel_end) = lower[head_start..].find('>') {
            let insert_at = head_start + rel_end + 1;
            let mut out = String::with_capacity(raw_html.len() + guard_script.len());
            out.push_str(&raw_html[..insert_at]);
            out.push_str(guard_script);
            out.push_str(&raw_html[insert_at..]);
            return out;
        }
    }
    if let Some(pos) = lower.find("<body") {
        let mut out = String::with_capacity(raw_html.len() + guard_script.len());
        out.push_str(&raw_html[..pos]);
        out.push_str(guard_script);
        out.push_str(&raw_html[pos..]);
        return out;
    }
    format!("{guard_script}{raw_html}")
}

/// Điều khiển Chromium headless qua CDP (`--remote-debugging-port=0`) để nhấn `Space` / `ArrowRight`
/// qua từng trạng thái slide, in mỗi trạng thái thành 1 trang PDF vector và ghép thành PDF hoàn chỉnh.
pub fn compile_html_via_cdp_slide_step(
    raw_html: &str,
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

    let tmp_dir = tempfile::tempdir()?;
    let user_data_dir = tmp_dir.path().join("chrome_profile");
    std::fs::create_dir_all(&user_data_dir)?;

    let guarded_html = inject_slide_dialog_guard(raw_html);
    let (_html_guard, html_file_path) =
        write_html_temp_for_browser(&guarded_html, input_path, base_dir, tmp_dir.path())?;
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
        .arg("--remote-debugging-port=0")
        .arg(format!("--user-data-dir={}", user_data_dir.display()))
        .arg("--window-size=1920,1080")
        .arg("about:blank")
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let Ok(child) = cmd.spawn() else {
        return Ok(None);
    };
    let mut child_guard = ChildProcessGuard(Some(child));

    let port = wait_for_devtools_port(&user_data_dir, &mut child_guard, cancel)?;
    let page_ws_url = find_page_ws_url(port, cancel)?;
    let mut ws = LocalWebSocket::connect(&page_ws_url)?;
    let mut next_id = 0u64;

    ws.cdp_call(&mut next_id, "Page.enable", json!({}), cancel, Duration::from_secs(5))?;
    ws.cdp_call(
        &mut next_id,
        "Emulation.setDeviceMetricsOverride",
        json!({ "width": 1920, "height": 1080, "deviceScaleFactor": 1, "mobile": false }),
        cancel,
        Duration::from_secs(5),
    )?;
    ws.cdp_call(
        &mut next_id,
        "Page.navigate",
        json!({ "url": file_uri }),
        cancel,
        Duration::from_secs(15),
    )?;

    // Chờ DOM tải hoàn tất và font sẵn sàng (giới hạn 1.5s cho font mạng ngoài).
    let load_deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < load_deadline {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let ready = ws.cdp_call(
            &mut next_id,
            "Runtime.evaluate",
            json!({ "expression": "document.readyState === 'complete'", "returnByValue": true }),
            cancel,
            Duration::from_secs(3),
        )?;
        if ready.pointer("/result/value").and_then(|v| v.as_bool()) == Some(true) {
            break;
        }
        std::thread::sleep(Duration::from_millis(60));
    }
    let _ = ws.cdp_call(
        &mut next_id,
        "Runtime.evaluate",
        json!({
            "expression": "Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 1500))])",
            "awaitPromise": true
        }),
        cancel,
        Duration::from_secs(4),
    );

    // Tự động nhận diện kích thước stage slide thực tế (VD: 1920x1080 hoặc 1280x720).
    let stage_dim = ws.cdp_call(
        &mut next_id,
        "Runtime.evaluate",
        json!({
            "expression": r#"(() => {
                const sels = ['#deckStage', '.deck-stage', '.reveal .slides', '.remark-slide-scaler', '.slide.active', '.slide', '[data-slide-stage]'];
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (!el) continue;
                    const cs = getComputedStyle(el);
                    const pw = parseFloat(cs.width);
                    const ph = parseFloat(cs.height);
                    if (pw >= 320 && ph >= 240 && pw <= 4096 && ph <= 2304) {
                        return { w: Math.round(pw), h: Math.round(ph) };
                    }
                    const r = el.getBoundingClientRect();
                    if (r.width >= 320 && r.height >= 240 && r.width <= 4096 && r.height <= 2304) {
                        return { w: Math.round(r.width), h: Math.round(r.height) };
                    }
                }
                return { w: 1280, h: 720 };
            })()"#,
            "returnByValue": true
        }),
        cancel,
        Duration::from_secs(5),
    )?;
    let width_px = stage_dim
        .pointer("/result/value/w")
        .and_then(|v| v.as_u64())
        .unwrap_or(1280)
        .clamp(320, 4096) as u32;
    let height_px = stage_dim
        .pointer("/result/value/h")
        .and_then(|v| v.as_u64())
        .unwrap_or(720)
        .clamp(240, 2304) as u32;

    ws.cdp_call(
        &mut next_id,
        "Emulation.setDeviceMetricsOverride",
        json!({ "width": width_px, "height": height_px, "deviceScaleFactor": 1, "mobile": false }),
        cancel,
        Duration::from_secs(5),
    )?;

    // Vô hiệu hóa rule @media print để Page.printToPDF in đúng bố cục màn hình hiện tại (1 slide/lần),
    // đồng thời rút ngắn transition/animation về 10ms để tránh chụp hình bị mờ dở dang.
    let prepare_expr = format!(
        r#"(() => {{
            for (const sheet of Array.from(document.styleSheets)) {{
                try {{
                    const rules = sheet.cssRules;
                    for (let i = rules.length - 1; i >= 0; i--) {{
                        if (rules[i].type === CSSRule.MEDIA_RULE && /print/i.test(rules[i].media.mediaText)) {{
                            sheet.deleteRule(i);
                        }}
                    }}
                }} catch (e) {{}}
            }}
            const prev = document.getElementById('knit-slide-step-style');
            if (prev) prev.remove();
            const st = document.createElement('style');
            st.id = 'knit-slide-step-style';
            st.textContent = '@page {{ size: {width_px}px {height_px}px; margin: 0; }} *, *::before, *::after {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; transition-delay: 0s !important; transition-duration: 0.01s !important; animation-delay: 0s !important; animation-duration: 0.01s !important; }}';
            (document.head || document.documentElement).appendChild(st);
            window.dispatchEvent(new Event('resize'));
            return true;
        }})()"#
    );
    ws.cdp_call(
        &mut next_id,
        "Runtime.evaluate",
        json!({ "expression": prepare_expr, "returnByValue": true }),
        cancel,
        Duration::from_secs(5),
    )?;

    std::thread::sleep(Duration::from_millis(260));

    let mut seen_hashes: HashSet<u64> = HashSet::new();
    let mut captured_pdfs: Vec<Vec<u8>> = Vec::new();

    let mut current_hash = capture_step_state_hash(&mut ws, &mut next_id, cancel)?;
    seen_hashes.insert(current_hash);
    captured_pdfs.push(capture_current_slide_pdf(
        &mut ws, &mut next_id, width_px, height_px, cancel,
    )?);

    let capture_deadline = Instant::now() + Duration::from_secs(SLIDE_CAPTURE_DEADLINE_SECS);
    let mut prefer_arrow = false;
    let trigger = &opts.html_step_trigger;

    for _step in 1..MAX_SLIDE_STEPS {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if Instant::now() > capture_deadline {
            break;
        }

        match trigger.kind {
            HtmlStepKind::AutoKey => {
                let primary = if prefer_arrow { "ArrowRight" } else { "Space" };
                dispatch_key_event_spec(&mut ws, &mut next_id, primary, cancel)?;
            }
            HtmlStepKind::Key => {
                let key_name = trigger.key.as_deref().unwrap_or("Space");
                dispatch_key_event_spec(&mut ws, &mut next_id, key_name, cancel)?;
            }
            HtmlStepKind::ClickSelector => {
                let sel = trigger.selector.as_deref().unwrap_or("");
                if !dispatch_click_selector(&mut ws, &mut next_id, sel, cancel)? {
                    break;
                }
            }
            HtmlStepKind::ClickPoint => {
                let nx = f64::from(trigger.click_x.unwrap_or(0.85).clamp(0.0, 1.0));
                let ny = f64::from(trigger.click_y.unwrap_or(0.5).clamp(0.0, 1.0));
                let px = (nx * f64::from(width_px)).clamp(1.0, f64::from(width_px.saturating_sub(1)));
                let py = (ny * f64::from(height_px)).clamp(1.0, f64::from(height_px.saturating_sub(1)));
                dispatch_mouse_click_px(&mut ws, &mut next_id, px, py, cancel)?;
            }
        }
        std::thread::sleep(Duration::from_millis(160));
        let mut next_hash = capture_step_state_hash(&mut ws, &mut next_id, cancel)?;

        if trigger.kind == HtmlStepKind::AutoKey && next_hash == current_hash && !prefer_arrow {
            dispatch_key_event_spec(&mut ws, &mut next_id, "ArrowRight", cancel)?;
            std::thread::sleep(Duration::from_millis(160));
            let arrow_hash = capture_step_state_hash(&mut ws, &mut next_id, cancel)?;
            if arrow_hash != current_hash {
                prefer_arrow = true;
                next_hash = arrow_hash;
            }
        }

        if next_hash == current_hash || !seen_hashes.insert(next_hash) {
            break;
        }

        current_hash = next_hash;
        captured_pdfs.push(capture_current_slide_pdf(
            &mut ws, &mut next_id, width_px, height_px, cancel,
        )?);
    }

    let _ = ws.cdp_call(&mut next_id, "Browser.close", json!({}), cancel, Duration::from_secs(2));
    drop(ws);
    child_guard.shutdown();

    let merged_bytes = merge_pdf_documents_mem(&captured_pdfs)?;
    let page_count = captured_pdfs.len();
    Ok(Some((merged_bytes, page_count)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_detects_keyboard_slide_deck_without_matching_plain_html_docs() {
        let deck = r#"<!DOCTYPE html><html><body>
            <main class="deck-stage">
                <section class="slide active">1</section>
                <section class="slide">2</section>
            </main>
            <script>
                window.addEventListener('keydown', (e) => {
                    if (e.code === 'Space' || e.key === 'ArrowRight') nextSlide();
                });
            </script>
        </body></html>"#;
        assert!(should_use_slide_step_auto(deck));

        let article = r#"<!DOCTYPE html><html><body>
            <article class="post"><h1>Guide</h1><p>Hello world</p></article>
        </body></html>"#;
        assert!(!should_use_slide_step_auto(article));
    }

    #[test]
    fn merge_pdf_documents_mem_combines_single_page_pdfs_cleanly() {
        let make_pdf = |label: &str| {
            let mut doc = Document::with_version("1.5");
            let pages_id = doc.new_object_id();
            let content = lopdf::Stream::new(
                Dictionary::new(),
                format!("BT /F1 18 Tf 50 700 Td ({label}) Tj ET").into_bytes(),
            );
            let content_id = doc.add_object(content);
            let mut font_dict = Dictionary::new();
            font_dict.set("Type", "Font");
            font_dict.set("Subtype", "Type1");
            font_dict.set("BaseFont", "Helvetica");
            let font_id = doc.add_object(font_dict);
            let mut font_map = Dictionary::new();
            font_map.set("F1", font_id);
            let mut res_dict = Dictionary::new();
            res_dict.set("Font", font_map);
            let resources_id = doc.add_object(res_dict);
            let mut page_dict = Dictionary::new();
            page_dict.set("Type", "Page");
            page_dict.set("Parent", pages_id);
            page_dict.set("MediaBox", vec![0.into(), 0.into(), 612.into(), 792.into()]);
            page_dict.set("Contents", content_id);
            page_dict.set("Resources", resources_id);
            let page_id = doc.add_object(page_dict);
            let mut pages_dict = Dictionary::new();
            pages_dict.set("Type", "Pages");
            pages_dict.set("Count", 1);
            pages_dict.set("Kids", vec![Object::Reference(page_id)]);
            doc.objects.insert(pages_id, Object::Dictionary(pages_dict));
            let mut catalog_dict = Dictionary::new();
            catalog_dict.set("Type", "Catalog");
            catalog_dict.set("Pages", pages_id);
            let catalog_id = doc.add_object(catalog_dict);
            doc.trailer.set("Root", catalog_id);
            let mut buf = Vec::new();
            doc.save_to(&mut buf).unwrap();
            buf
        };

        let merged = merge_pdf_documents_mem(&[make_pdf("Slide 1"), make_pdf("Slide 2"), make_pdf("Slide 3")]).unwrap();
        assert!(merged.starts_with(b"%PDF-"));
        let meta = Document::load_metadata_mem(&merged).unwrap();
        assert_eq!(meta.page_count, 3);
    }
}
