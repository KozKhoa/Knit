use thiserror::Error;

/// Kiểu lỗi chuẩn dùng chung trên toàn hệ thống lõi Knit.
#[derive(Debug, Error)]
pub enum KnitError {
    #[error("Tác vụ đã bị hủy bởi người dùng")]
    Cancelled,

    #[error("Không đủ dung lượng trống: cần ~{needed}, chỉ còn {available}")]
    InsufficientDiskSpace { needed: String, available: String },

    #[error("Đường dẫn không hợp lệ hoặc vượt khỏi thư mục gốc: {0}")]
    InvalidPath(String),

    #[error("Không tìm thấy đường dẫn: {0}")]
    NotFound(String),

    #[error("Dữ liệu đầu vào không hợp lệ: {0}")]
    InvalidInput(String),

    #[error("Lỗi I/O: {0}")]
    Io(#[from] std::io::Error),

    #[error("Lỗi xử lý nội bộ: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, KnitError>;
