# Knit — Quy chuẩn Kỹ thuật & Chất lượng (RULES)

Mọi code, PR và thay đổi cấu hình trong dự án **Knit** phải tuân thủ các quy tắc dưới đây.

---

## 1. Kiến trúc & Tách lớp (Boundaries)
1. **Lõi thuần Rust không phụ thuộc UI:** Tất cả các crate trong `crates/knit-*` tuyệt đối **không** import `tauri` hay crate giao diện. Mọi callback tiến trình, log và hủy tác vụ truyền qua trait/closure chuẩn Rust.
2. **Tauri shell mỏng (`src-tauri`):** Chỉ làm nhiệm vụ ánh xạ đường dẫn, gọi hàm từ `crates/knit-*`, quản lý `JobManager` và phát sự kiện về Frontend. Không viết logic nghiệp vụ (regex rename, CSV schema, remap bookmark) trong `src-tauri` hay trong TypeScript.
3. **Frontend không giữ logic xử lý file nặng:** React/TS chỉ giữ state UI, thao tác kéo-thả, tọa độ Canvas chuẩn hóa `[0.0, 1.0]` và hiển thị bảng/preview.

---

## 2. An toàn File, Đĩa & Dữ liệu Người dùng
1. **Không phá hủy file gốc (Non-destructive by default):**
   - Các tool `Image → PDF`, `PDF Merge/Split`, `Document → PDF`, `Archive`, `Manga Packager` chỉ được **đọc** file đầu vào. Mọi crop/xoay/text/vẽ chỉ áp dụng lên bản xuất mới.
   - Ngoại lệ duy nhất sửa trên đĩa là **Batch Renamer** khi người dùng bấm Apply — và bắt buộc phải qua bước **Dry-Run Preview + Collision Detection + UndoManifest**.
2. **Ghi file nguyên tử (`AtomicOutput`):**
   - Mọi output (`.pdf`, `.zip`, `.tar.*`, `stories.csv`, `user_presets.json`) phải ghi ra file tạm (`.tmp`/`.part`) trong cùng thư mục đích (hoặc thư mục tạm rồi move/replace), chỉ đổi sang tên chính thức sau khi ghi và flush hoàn tất.
   - Khi bị hủy (`Cancelled`) hoặc lỗi giữa chừng, **xóa sạch toàn bộ file tạm và part dở dang** của job đó.
3. **Kiểm tra dung lượng & Chống Path Traversal:**
   - Kiểm tra dung lượng trống ổ đĩa trước khi nén/ghép dung lượng lớn.
   - Khi đọc đường dẫn tương đối từ `info.json` hoặc cấu trúc archive, bắt buộc canonicalize/kiểm tra tiền tố để chặn path traversal (`../../...`).
4. **Tương thích chéo Windows & Linux:**
   - Sanitize tên file đầu ra: loại bỏ ký tự cấm Windows (`< > : " / \ | ? *` và ký tự điều khiển), cắt dấu chấm/khoảng trắng thừa ở cuối tên.
   - Chuẩn hóa tên file/thư mục đầu vào theo **Unicode NFC** trước khi so khớp regex (tránh lỗi tên tiếng Việt dạng NFD từ macOS/USB).
   - So sánh xung đột tên file theo chế độ **case-insensitive** để bảo vệ ổ NTFS/exFAT/Windows; xử lý đổi hoa-thường cùng tên qua bước tên tạm trung gian.
   - Đường dẫn nội bộ trong ZIP/TAR/CSV luôn dùng dấu `/`.

---

## 3. Quy chuẩn UI / Design ([DESIGIN.md](DESIGIN.md))
1. **Flat & Sạch sẽ:** Tuân thủ bảng màu, font (`Lato`, `JetBrains Mono`), bo góc `4px`, không dùng gradient trang trí, không dùng màu đen tuyệt đối `#000000`.
2. **Không dùng Emoji trong UI:** Dùng icon vector thống nhất (**Lucide**). *(Lưu ý: log kỹ thuật nội bộ cũng ưu tiên ký hiệu rõ ràng, gọn gàng).*
3. **Trạng thái rõ ràng:** Mọi công cụ phải có đủ Empty State hướng dẫn kéo-thả, Progress bar + nút Cancel khi chạy, Error banner nêu nguyên nhân cụ thể, và cảnh báo rõ nếu thiếu `ExternalOffice` engine (`docx`/`pptx`).

---

## 4. Quy chuẩn Kiểm thử & Tài liệu
1. **Đơn vị kiểm thử bắt buộc cho lõi:**
   - `knit-manga`: Golden test đối chiếu output `stories.csv` & cấu trúc entry với `Mangament/tool/app/tools/zip_pack`.
   - `knit-renamer`: Test đủ `s///`, `y///`, chuỗi `;`, Include/Exclude filter, collision hoa-thường, thực thi Bottom-Up và Undo.
   - `knit-pdf`: Test `remap_tree`, giới hạn trang `[3.0, 14400.0]` pt, tách/ghép PDF, rasterize `CropRect` + `AnnotationLayer` đúng tọa độ.
   - `knit-archive`: Test tạo và mở giải mã kiểm chứng ZIP có password AES-256 & ZipCrypto, TAR/GZ/ZST.
2. **Cập nhật ADR khi đổi quyết định:** Nếu kết quả Technical Spike (Milestone 0) làm thay đổi thư viện hoặc hướng thiết kế (ví dụ chuyển cách render HTML/EPUB), phải cập nhật hoặc thêm ADR mới trong `docs/decisions/` (Supersede ADR cũ, không xóa ADR cũ).
3. **Không làm giả/lách kiểm thử:** Tuyệt đối không bỏ qua lỗi biên dịch, không tắt cảnh báo lint/test để đạt trạng thái pass.
