use thiserror::Error;

/// Kiểu lỗi chuẩn dùng chung trên toàn hệ thống lõi Knit.
#[derive(Debug, Error)]
pub enum KnitError {
    #[error("Job cancelled by user")]
    Cancelled,

    #[error("Insufficient disk space: need ~{needed}, available {available}")]
    InsufficientDiskSpace { needed: String, available: String },

    #[error("Invalid path or outside root directory: {0}")]
    InvalidPath(String),

    #[error("Path not found: {0}")]
    NotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, KnitError>;
