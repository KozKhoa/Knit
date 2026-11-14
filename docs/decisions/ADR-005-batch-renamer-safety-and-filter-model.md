# ADR-005: Mô hình An toàn & Bộ lọc hai lớp cho Batch Renamer

## Status
Accepted

## Date
2026-11-13

## Context
Trong `MangamentTools`, `renamer` đã có `PrenameEngine` (hỗ trợ Perl `s///`, `y///`), các preset manga và cơ chế phát hiện trùng tên (`Collision Detection`). Tuy nhiên, bản cũ chỉ có 1 ô regex `name_filter` đơn giản nên dễ đổi nhầm file cấu hình hoặc thư mục không mong muốn. Người dùng yêu cầu nâng cấp khả năng **lọc cái nào nên đổi, cái nào không** trước khi thực thi trên ổ đĩa thật.

## Decision
Áp dụng quy trình **Filter → Dry-Run Plan → Selective Apply → Undo** với 4 chốt an toàn:
1. **Bộ lọc hai lớp (`ScanFilter` + Per-item Selection):**
   - **Lớp 1 (Quy tắc quét):** Lọc theo đối tượng (`Files` / `Folders` / `Both`), `recursive` + `max_depth`, bỏ qua file/folder ẩn (`.git`, `.DS_Store`, `._*`), danh sách **Include** (đuôi file, glob/regex) và danh sách **Exclude** (ví dụ mặc định gợi ý hoặc preset loại trừ `info.json`, `cover*`, `*.json`).
   - **Lớp 2 (Chọn lọc trên Preview):** Bảng Dry-Run hiển thị 4+ cột (*Checkbox*, *Tên gốc*, *Tên mới*, *Loại/Đường dẫn*, *Trạng thái*), cho phép tick/bỏ tick từng dòng hoặc hàng loạt theo trạng thái trước khi bấm Apply.
2. **Kiểm tra xung đột chéo hệ điều hành (Collision Detection):**
   - Phát hiện trùng tên đích trong cùng batch và trùng với file/folder đã tồn tại trên đĩa.
   - Luôn so sánh xung đột theo **case-insensitive** (`to_lowercase()` / casefold) ngay cả trên Linux để tránh lỗi ghi đè khi làm việc trên ổ USB/exFAT hoặc chia sẻ sang Windows, ngoại trừ trường hợp đổi hoa-thường của chính file đó (xử lý qua tên tạm 2 bước trên Windows/case-insensitive FS!).
3. **Thứ tự thực thi Bottom-Up:**
   - Luôn sắp xếp đổi tên thư mục con ở tầng sâu hơn trước (`depth` giảm dần), sau đó mới đổi thư mục cha để đường dẫn chưa xử lý không bị mất hiệu lực giữa chừng.
4. **Hoàn tác an toàn (`UndoManifest`):**
   - Mỗi lần Apply ghi lại manifest JSON ánh xạ danh sách đã đổi thành công theo thứ tự đảo ngược, cho phép Undo 1 click khi không có xung đột mới phát sinh.

## Alternatives Considered

### Đổi tên trực tiếp theo quy tắc mà không có checkbox chọn từng dòng
- **Rejected (theo Q5: A):** Người dùng muốn vừa lọc bằng rule vừa kiểm soát trực quan từng item nên/không nên đổi trên bảng preview.

## Consequences
- Cần xử lý đặc biệt trường hợp đổi hoa-thường trên Windows (ví dụ `chap1.jpg` -> `Chap1.jpg`): NTFS/FAT coi 2 đường dẫn bằng nhau nếu chỉ khác hoa-thường nên `fs::rename` trực tiếp có thể không đổi tên hoặc cần rename qua tên trung gian tạm rồi mới sang tên đích.
- Bộ preset cố định và cú pháp `s///`, `y///` từ `MangamentTools` phải được giữ tương thích trong `knit-renamer`.
