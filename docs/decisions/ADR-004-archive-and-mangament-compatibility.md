# ADR-004: Đóng gói Archive & Tương thích Nghiệp vụ `zip_pack` của MangamentTools

## Status
Accepted

## Date
2026-11-13

## Context
Knit vừa phục vụ nén file/folder phổ thông (`zip`, `tar`, `tar.gz`, `tar.zst`, đặt mật khẩu cho ZIP), vừa thay thế trực tiếp tool `zip_pack` trong `/home/khoa/Code/Project/Mangament/tool/app/tools/zip_pack/`.
Phân tích `zip_pack` cho thấy các ràng buộc nghiệp vụ cụ thể cần bảo toàn:
- Tự nhận diện thư mục 1 truyện vs thư viện nhiều truyện (`looks_like_single_story`).
- Chuẩn hóa tên thư mục bằng Unicode **NFC** trước khi regex parse `NodeRef` (`volume`, `arc`, `chapter`, số thập phân `1.5`, tiếng Việt `Chương`, `Tập`, `Hồi`).
- Tìm ảnh bìa (`cover_art`, `cover`, `poster`) và đọc `info.json` (`utf-8-sig`), chặn path traversal khi `info.json` trỏ đường dẫn `cover_art`.
- Khi chia part theo `max_gb`, không cắt đôi 1 truyện; mỗi ZIP part có `stories.csv` riêng tương ứng các truyện trong part đó.
- Ảnh nén ở chế độ `STORE` (mức 0, không mất CPU nén lại JPEG/WebP/AVIF), còn `stories.csv` và `info.json` nén `DEFLATE`.

## Decision
1. **Tách Archive Engine và Manga Packager thành 2 luồng rõ ràng trên cùng lõi nén:**
   - **Archive Tool (phổ thông):** Nén file/thư mục tùy ý sang `.zip` (chọn mức nén, tùy chọn mật khẩu **AES-256** mặc định hoặc **ZipCrypto** tương thích) hoặc `.tar` / `.tar.gz` / `.tar.zst`.
   - **Manga Packager Tool:** Quét cấu trúc manga (`MangaScanMode`), xem trước cây truyện + cảnh báo (thiếu ảnh, trùng `(type, order_index)`, không đọc được `info.json`), đóng gói ra `.zip` / `.cbz` tối ưu (`STORE` cho ảnh).
2. **Cơ chế `MangamentPackageMode` (Tùy chọn trong Manga Packager):**
   - Khi tắt (mặc định cho người dùng phổ thông): đóng gói sạch cấu trúc `Story/Chapter/images` (+ cover) thành `.zip`/`.cbz`.
   - Khi bật: đọc `info.json`, nhúng `info.json` và xuất `stories.csv` đúng 100% schema RFC 4180 của `zip_pack/csv_builder.py` (`BASE_HEADERS` + `NODE_HEADERS * max_depth` căn phải + `CONTENT_HEADERS`), chia part nguyên truyện theo `max_gb`.
3. **An toàn ổ đĩa & Nguyên tử:** Kiểm tra dung lượng trống trước khi chạy (`disk_usage`), ghi ra file `.tmp`, hoàn tất mới replace sang file đích; xóa sạch file `.tmp`/part đã tạo nếu bị hủy hoặc lỗi.

## Alternatives Considered

### Bỏ hoàn toàn `stories.csv` khỏi Knit và giữ `MangamentTools` chạy song song
- **Rejected (theo Q3: B):** Người dùng muốn dùng 1 app duy nhất thay thế hoàn toàn `MangamentTools`.

### Bật `stories.csv` mặc định cho mọi lần nén Manga
- **Rejected:** Người dùng phổ thông chỉ muốn nén truyện thành `.cbz`/`.zip` để đọc sẽ thấy file `stories.csv` dư thừa và khó hiểu.

## Consequences
- Cần viết bộ golden test so sánh trực tiếp cấu trúc ZIP và nội dung từng dòng `stories.csv` sinh bởi Knit với bộ test/fixture tham chiếu từ `Mangament/tool/tests/`.
- Chú ý chuẩn hóa đường dẫn bên trong ZIP/TAR luôn dùng dấu `/` (POSIX separator), kể cả khi chạy trên Windows.
