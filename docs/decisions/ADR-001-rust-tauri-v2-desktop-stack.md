# ADR-001: Chọn Rust + Tauri v2 làm nền tảng Desktop App cho Knit

## Status
Accepted

## Date
2026-11-13

## Context
Knit cần đáp ứng đồng thời các ràng buộc đã chốt:
1. Chạy dưới dạng **Desktop App cửa sổ độc lập** (không qua trình duyệt web) trên cả **Windows** và **Linux**.
2. Đóng gói public cho người dùng phổ thông thành **1 file thực thi/cài đặt gọn nhẹ** (`.exe` / `.AppImage`), bấm là chạy **offline 100%**.
3. Hỗ trợ giao diện tương tác trực quan phức tạp: lưới thumbnail kéo-thả sắp xếp trang, trình **crop ảnh, chèn text và vẽ tự do lên ảnh** trước khi xuất PDF, cùng giao diện phẳng hiện đại theo [DESIGIN.md](../../DESIGIN.md).
4. Hỗ trợ nén ZIP có mật khẩu (AES-256), TAR, xử lý ảnh đa luồng (`webp`, `avif`, `gif`, `png`, `jpg`), ghép/tách PDF và Batch Renamer hiệu năng cao.

## Decision
Sử dụng kiến trúc **Rust Workspace + Tauri v2**:
- **Backend / Core (`crates/knit-*`)**: Viết bằng **Rust**, tách hoàn toàn logic nghiệp vụ khỏi Tauri UI để kiểm thử độc lập và sẵn sàng tái sử dụng (kể cả nếu v2 bổ sung CLI).
- **Desktop Shell (`src-tauri`)**: Tauri v2 quản lý cửa sổ desktop native, kéo-thả file từ OS, file dialogs, hệ thống tiến trình nền và IPC commands/events.
- **Frontend UI (`src/`)**: React + TypeScript + Tailwind CSS (theo hệ token trong [DESIGIN.md](../../DESIGIN.md)), render trong WebView tích hợp của hệ điều hành (WebView2 trên Windows, WebKitGTK trên Linux), sử dụng HTML5 Canvas cho editor crop/text/vẽ ảnh.

## Alternatives Considered

### Python + PySide6 (kế thừa trực tiếp `MangamentTools`)
- **Pros:** Tái sử dụng được code Python từ `/home/khoa/Code/Project/Mangament/tool` (`img2pdf`, `pikepdf`, `Pillow`, `zip_pack`, `renamer`).
- **Cons:**
  - Gói PyInstaller `--onefile` kèm PySide6 + thư viện xử lý PDF/HTML/Ảnh thường nặng **100–200+ MB**, khởi động chậm và hay gặp báo nhầm virus (false positive) trên Windows.
  - Thư viện chuẩn `zipfile` của Python không tạo được ZIP có mật khẩu.
  - Xây dựng editor crop/text/vẽ mượt mà trên `QGraphicsView`/QSS tốn nhiều công sức hơn đáng kể so với HTML5 Canvas.
- **Rejected:** Vi phạm ràng buộc bộ cài gọn nhẹ cho người dùng phổ thông và bất lợi ở editor tương tác.

### Pure Rust GUI (`egui`, `Iced`, `Slint`)
- **Pros:** Không dùng WebView, binary thuần 100%.
- **Cons:** Việc xây dựng trình vẽ tự do + đặt/sửa text box + crop đa tỉ lệ + kéo-thả thumbnail + cây bookmark lồng cấp với UI phẳng hiện đại tốn rất nhiều thời gian; không tận dụng được trực tiếp các token CSS/Tailwind từ [DESIGIN.md](../../DESIGIN.md).
- **Rejected:** Chi phí phát triển UI/Canvas quá cao so với giá trị mang lại.

## Consequences
- **Tích cực:**
  - Bộ cài lõi nhẹ (~15–25 MB), khởi động nhanh, xử lý ảnh/ZIP/rename đa luồng tận dụng CPU tốt.
  - Có sẵn `zip` crate hỗ trợ AES-256 & ZipCrypto, `tar` + `flate2`/`zstd`, và hệ sinh thái Canvas/Drag-Drop cực mạnh ở frontend.
- **Rủi ro & Đánh đổi cần kiểm soát:**
  - Không dùng lại trực tiếp code Python của `MangamentTools`, phải port logic (nhất là `zip_pack` `stories.csv` và `PrenameEngine`) sang Rust và đối chiếu output bằng test.
  - Cần chạy Technical Spike sớm cho việc cross-compile giải mã **AVIF** và xử lý edge-case **PDF** trên cả Windows (MSVC) và Linux (`webkit2gtk` trong AppImage).
