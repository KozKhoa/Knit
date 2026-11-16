use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Cơ chế tín hiệu hủy an toàn giữa UI và worker nền.
#[derive(Debug, Clone, Default)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn check(&self) -> crate::Result<()> {
        if self.is_cancelled() {
            Err(crate::KnitError::Cancelled)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum JobLogLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogVerbosity {
    #[default]
    Minimal = 0,
    Normal = 1,
    Detailed = 2,
}

impl LogVerbosity {
    pub fn from_u8(val: u8) -> Self {
        match val {
            1 => Self::Normal,
            2..=u8::MAX => Self::Detailed,
            _ => Self::Minimal,
        }
    }
}

/// Dữ liệu tiến trình phát về UI (giới hạn tần suất ở lớp Reporter).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current_item: String,
}

impl JobProgress {
    pub fn percent(&self) -> f64 {
        if self.bytes_total > 0 {
            (self.bytes_done as f64 / self.bytes_total as f64) * 100.0
        } else if self.total > 0 {
            (self.done as f64 / self.total as f64) * 100.0
        } else {
            0.0
        }
    }
}

/// Giao diện trừu tượng để lõi phát tiến trình và log mà không phụ thuộc Tauri.
pub trait JobReporter: Send + Sync {
    fn on_progress(&self, progress: JobProgress);
    fn on_log(&self, level: JobLogLevel, message: &str);
    fn on_log_detail(&self, _verbosity: LogVerbosity, level: JobLogLevel, message: &str) {
        self.on_log(level, message);
    }
}

/// Tiện ích ghi log nhanh cho mọi `JobReporter` (kể cả `&dyn JobReporter`).
pub trait JobReporterExt: JobReporter {
    fn info(&self, message: impl AsRef<str>) {
        self.on_log_detail(LogVerbosity::Minimal, JobLogLevel::Info, message.as_ref());
    }

    fn normal(&self, message: impl AsRef<str>) {
        self.on_log_detail(LogVerbosity::Normal, JobLogLevel::Info, message.as_ref());
    }

    fn detailed(&self, message: impl AsRef<str>) {
        self.on_log_detail(LogVerbosity::Detailed, JobLogLevel::Info, message.as_ref());
    }

    fn warn(&self, message: impl AsRef<str>) {
        self.on_log_detail(LogVerbosity::Minimal, JobLogLevel::Warn, message.as_ref());
    }

    fn error(&self, message: impl AsRef<str>) {
        self.on_log_detail(LogVerbosity::Minimal, JobLogLevel::Error, message.as_ref());
    }
}

impl<T: JobReporter + ?Sized> JobReporterExt for T {}

#[derive(Debug, Default)]
pub struct NoopReporter;

impl JobReporter for NoopReporter {
    fn on_progress(&self, _progress: JobProgress) {}
    fn on_log(&self, _level: JobLogLevel, _message: &str) {}
}

/// Bộ bọc throttle tiến trình (~10 lần/giây) tránh làm nghẽn IPC WebView.
pub struct ThrottledReporter<R: JobReporter> {
    inner: R,
    interval: Duration,
    last_emit: Mutex<Option<Instant>>,
}

impl<R: JobReporter> ThrottledReporter<R> {
    pub fn new(inner: R, interval: Duration) -> Self {
        Self {
            inner,
            interval,
            last_emit: Mutex::new(None),
        }
    }

    pub fn emit_forced(&self, progress: JobProgress) {
        if let Ok(mut guard) = self.last_emit.lock() {
            *guard = Some(Instant::now());
        }
        self.inner.on_progress(progress);
    }
}

impl<R: JobReporter> JobReporter for ThrottledReporter<R> {
    fn on_progress(&self, progress: JobProgress) {
        let is_terminal = progress.total > 0 && progress.done >= progress.total;
        let should_emit = if is_terminal {
            true
        } else if let Ok(mut guard) = self.last_emit.lock() {
            let now = Instant::now();
            let due = guard.map(|t| now.duration_since(t) >= self.interval).unwrap_or(true);
            if due {
                *guard = Some(now);
            }
            due
        } else {
            true
        };

        if should_emit {
            self.inner.on_progress(progress);
        }
    }

    fn on_log(&self, level: JobLogLevel, message: &str) {
        self.inner.on_log(level, message);
    }

    fn on_log_detail(&self, verbosity: LogVerbosity, level: JobLogLevel, message: &str) {
        self.inner.on_log_detail(verbosity, level, message);
    }
}
