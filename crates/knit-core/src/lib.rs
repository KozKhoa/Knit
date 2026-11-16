//! Lõi hạ tầng dùng chung cho toàn bộ workspace Knit.
//! Không chứa phụ thuộc UI/Tauri (xem RULES.md).

pub mod error;
pub mod fs;
pub mod job;
pub mod sort;

pub use error::{KnitError, Result};
pub use fs::{
    app_cache_dir, app_config_dir, atomic_write_file, ensure_disk_space, human_size,
    nfc_normalize, safe_join_within, sanitize_filename,
};
pub use job::{
    CancellationToken, JobLogLevel, JobProgress, JobReporter, JobReporterExt, LogVerbosity,
    NoopReporter,
};
pub use sort::{natural_cmp, natural_sort_by};
