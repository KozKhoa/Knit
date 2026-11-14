# ADR-003: Pipeline PageDraft Không Phá Hủy & Tối Ưu Xuất PDF

## Status
Accepted

## Date
2026-11-13

## Context
Trong module **Image → PDF** (và chỉnh sửa trang khi ghép PDF), người dùng cần:
- Hỗ trợ nhiều định dạng ảnh (`jpg`, `png`, `webp`, `avif`, `gif` kể cả ảnh động).
- Kéo-thả sắp xếp thứ tự, xoay trang, chọn khổ giấy/lề, chia part `max MB`, nhúng cây bookmark.
- **Crop cơ bản, chèn text và vẽ tự do trực tiếp lên ảnh** ngay trong quá trình chuẩn bị ghép PDF.
- Đồng thời vẫn giữ được tốc độ cao và không làm giảm chất lượng với các ảnh manga/scan số lượng lớn không qua chỉnh sửa.

## Decision
1. **Mô hình `PageDraft` không phá hủy (Non-destructive):**
   - File ảnh/PDF gốc trên ổ đĩa chỉ được đọc (`read-only`).
   - Toàn bộ thao tác ở UI (thứ tự trang, xoay `0/90/180/270`, `CropRect` chuẩn hóa `[0..1]`, `TextAnnotation`, `StrokeAnnotation`, nhãn bookmark) được lưu thành cấu trúc `PageDraft` nhẹ bằng JSON/state trong phiên làm việc.
2. **Nhánh xuất PDF kép (Dual Export Path):**
   - **Lossless Passthrough Fast-Path:** Nếu trang là ảnh JPEG/PNG không cần xoay EXIF, không crop, không annotation, và không ép nén lại chất lượng: nhúng thẳng stream ảnh gốc vào PDF (giống `img2pdf` trong `MangamentTools`), tránh giải mã/nén lại gây mất nét hoặc chậm với bộ truyện hàng nghìn trang.
   - **Render & Composite Path:** Khi trang là `webp`/`avif`/`gif`, có EXIF orientation, hoặc có `crop`/`text`/`stroke`/resize: Rust đọc ảnh gốc, áp dụng `exif_transpose` -> `rotate` -> `crop` -> composite các `AnnotationLayer` (alpha trên nền trắng) -> encode sang JPEG/PNG tối ưu trước khi nhúng vào PDF.
3. **Chuẩn kích thước & Bookmark:**
   - Hỗ trợ `OriginalSize` (1px = 1pt, giới hạn `[3.0, 14400.0]` pt theo chuẩn ISO 32000-1 để hỗ trợ webtoon siêu dài như `MangamentTools`) hoặc chuẩn trang in (`A4`, `Letter`, kèm margin).
   - Cây `BookmarkNode` tự động đánh số lại qua hàm `remap_tree` khi người dùng bật chia part theo `max MB` hoặc xóa/bỏ qua trang lỗi.
4. **Hiệu năng Canvas UI:**
   - Rust sinh thumbnail cache độ phân giải vừa phải cho lưới kéo-thả; khi mở 1 trang vào modal/panel Crop & Vẽ, load ảnh đủ nét trên Canvas và truyền lại tọa độ chuẩn hóa `[0.0, 1.0]` về Rust để tránh giữ hàng trăm bitmap 4K trong RAM trình WebView.

## Alternatives Considered

### Lưu ảnh đã sửa ra file tạm trên đĩa ngay mỗi nét vẽ/crop
- **Pros:** Bước Export cuối đơn giản.
- **Cons:** Phá hủy khả năng Undo/sửa lại chữ hoặc nét vẽ đã đặt, tốn I/O đĩa liên tục và chậm UI.
- **Rejected.**

### Render mọi ảnh lại bằng trình duyệt Canvas rồi gửi PNG/DataURL sang Rust
- **Pros:** Không cần Rust vẽ text/stroke khi export.
- **Cons:** Gửi ảnh full-res qua IPC WebView <-> Rust gây nghẽn RAM/IPC với hàng trăm ảnh scan lớn (webtoon/4K), mất hoàn toàn lợi thế *Lossless Passthrough*.
- **Rejected.**

## Consequences
- Frontend và Backend phải dùng chung **hệ tọa độ chuẩn hóa `[0.0, 1.0]`** theo kích thước ảnh sau khi xoay để đảm bảo những gì vẽ trên Canvas khớp vị trí khi Rust render ra PDF (cần kiểm chứng bằng visual snapshot test).
- Cần nhúng/chọn font mặc định hỗ trợ đầy đủ tiếng Việt (ví dụ Noto Sans / Lato) cho `TextAnnotation` khi Rust rasterize lên ảnh.
