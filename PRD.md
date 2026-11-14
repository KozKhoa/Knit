# Knit — Product Requirements Document (PRD)

> **Trạng thái:** Approved Baseline (sau phiên Grill & Domain Modeling ngày 2026-11-13)  
> **Từ điển thuật ngữ:** [docs/glossary.md](docs/glossary.md)  
> **Quyết định kiến trúc:** [docs/decisions/](docs/decisions/)

---

## 1. Mục tiêu & Đối tượng Sử dụng

### 1.1. Bối cảnh & Vấn đề
- Các công cụ web phổ biến (CloudConvert, iLovePDF, MarkdownToPDF) giới hạn số lần xử lý/ngày, giới hạn dung lượng, yêu cầu upload file lên server và phụ thuộc Internet.
- Bộ công cụ cũ `MangamentTools` (Python/PySide6) xử lý tốt đóng gói manga và rename, nhưng thiếu phần chỉnh sửa ảnh/trang trực quan, thiếu chuyển đổi tài liệu (`md`, `epub`, `html`, `docx`, `pptx`), thiếu ghép/tách PDF đa năng, thiếu nén ZIP đặt mật khẩu / TAR, và gói đóng gói Python nặng.

### 1.2. Đối tượng sử dụng (Target Users)
1. **Người dùng chính (Author / Power User):** Cần một công cụ desktop dùng hàng ngày trên Windows & Linux thay thế hoàn toàn web tools và thay thế `MangamentTools` (kể cả xuất `stories.csv`).
2. **Người dùng phổ thông (Public Desktop Users):** Cần tải 1 file cài đặt gọn nhẹ (`.exe` / `.AppImage`), mở lên là chạy **offline 100%**, giao diện trực quan kiểu iLovePDF/CloudConvert, không cần cài Python hay cấu hình môi trường.

---

## 2. Phạm vi Chức năng v1 (Functional Requirements)

### M1. Image → PDF (Ghép ảnh & Trình chỉnh sửa trực quan)
- **Định dạng đầu vào:** `.jpg`, `.jpeg`, `.jfif`, `.png`, `.webp`, `.avif`, `.gif`, `.bmp`, `.tif`, `.tiff`.
- **Ảnh động (`gif`, `webp` động):** Hỗ trợ 2 chế độ theo `AnimatedImagePolicy` — chỉ lấy khung đầu hoặc tách khung thành trang kèm thời lượng `/Dur` (có giới hạn số khung).
- **Quản lý danh sách & cây Bookmark:**
  - Nạp ảnh lẻ hoặc quét đệ quy thư mục truyện (`Volume -> Arc -> Chapter`, ưu tiên `cover_art`/`cover` lên đầu, `NaturalSortKey`).
  - Lưới thumbnail hỗ trợ **kéo-thả đổi thứ tự**, thêm/xóa trang, chọn hàng loạt.
  - Tự động sinh cây `BookmarkNode` từ cấu trúc thư mục, cho phép **thêm/sửa/xóa/kéo-thả cây bookmark** trực tiếp trên UI.
- **Chỉnh sửa không phá hủy (`PageDraft`):**
  - Xoay trang (`90°`, `180°`, `270°`), lật ngang/dọc.
  - **Crop ảnh cơ bản** (kéo khung tự do hoặc theo tỉ lệ).
  - **Chèn Text lên ảnh** (chọn vị trí, nội dung, cỡ chữ, màu chữ; hỗ trợ đầy đủ tiếng Việt UTF-8).
  - **Vẽ lên ảnh** (bút vẽ tự do/highlight, chọn màu & độ dày nét, Undo/Redo nét vẽ).
- **Thiết lập xuất PDF:**
  - Khổ trang: `OriginalSize` (1px = 1pt, giới hạn `[3.0, 14400.0]` pt chuẩn ISO 32000-1 cho webtoon dài) hoặc `FitA4` / `FitLetter` kèm margin.
  - Nén ảnh tùy chọn hoặc **Lossless Passthrough** cho JPEG/PNG không chỉnh sửa.
  - Chia part theo dung lượng tối đa (`MaxBytes` / MB) kèm `remap_tree` tự động chỉnh lại trang bookmark cho từng part.

### M2. PDF Merge & Split (Ghép & Tách PDF)
- **Ghép PDF (Merge):** Chọn nhiều file PDF, kéo-thả sắp xếp thứ tự file hoặc mở rộng thành từng trang (`PdfPageRef`) để sắp xếp, xóa trang thừa, xoay trang, và giữ/gộp hoặc tạo mới cây `BookmarkNode`.
- **Tách PDF (Split):**
  - Tách theo khoảng trang tùy chỉnh (ví dụ `1-5, 8, 10-15`).
  - Tách đều mỗi `N` trang thành nhiều file.
  - Trích xuất các trang được tick chọn trên lưới thumbnail.
  - Tách theo dung lượng tối đa (`MaxBytes`), giữ nguyên bookmark trong vùng trang tương ứng.

### M3. Document → PDF (Chuyển đổi Tài liệu)
- **Nhóm Core Native (chạy offline ngay trong app, không cần cài thêm gì):**
  - `md`, `txt` → PDF (hỗ trợ Markdown GFM: bảng, code block, tiêu đề, danh sách, ảnh cục bộ, tiếng Việt UTF-8).
  - `html`, `epub` → PDF (chọn cỡ giấy, lề, font/kiểu trang; giữ cấu trúc chương/mục lục cho EPUB).
- **Nhóm Office External (qua Optional Engine — ADR-002):**
  - `docx`, `pptx` → PDF thông qua tự động phát hiện LibreOffice (`soffice`) trên máy hoặc cho phép người dùng trỏ đường dẫn / cài gói hỗ trợ.
  - UI hiển thị rõ trạng thái `EngineStatus` và hướng dẫn rõ ràng nếu máy chưa có LibreOffice.

### M4. Archive (Nén File & Thư mục)
- **Định dạng đầu ra:** `.zip`, `.tar`, `.tar.gz` (`.tgz`), `.tar.zst`.
- **Tùy chọn nén:** Chọn mức nén (`Store / Fast / Normal / Best`).
- **Bảo mật ZIP:** Đặt **password** cho file `.zip` với lựa chọn mã hóa **AES-256** (mặc định) hoặc **ZipCrypto** (tương thích giải nén cũ).
- **An toàn đường dẫn:** Dùng chuẩn `/` trong archive bất kể Windows hay Linux; tùy chọn giữ/bỏ thư mục gốc bao ngoài.

### M5. Manga Packager (Kế thừa `zip_pack` của `MangamentTools`)
- Quét 1 truyện hoặc thư viện nhiều truyện (`Auto` / `SingleStory` / `Library`), nhận diện ảnh bìa (`cover_art`, `cover`, `poster`) và cấu trúc `Volume / Arc / Chapter` (chuẩn hóa NFC Unicode).
- Hiển thị cây xem trước + **báo cáo cảnh báo** (chapter thiếu ảnh, thư mục trùng `(type, order_index)`, lỗi `info.json`).
- Đóng gói `.zip` / `.cbz` với chế độ `STORE` cho ảnh; chia file theo `max_gb` (không cắt đôi truyện).
- **Tùy chọn `MangamentPackageMode` (bật/tắt):** Khi bật, đọc `info.json` (`utf-8-sig`) và xuất file `stories.csv` đúng schema RFC 4180 của Mangament Server (mỗi part ZIP có `stories.csv` riêng).

### M6. Batch Renamer (Đổi tên Hàng loạt với Bộ lọc hai lớp)
- **Bộ lọc nguồn (`ScanFilter`):**
  - Chọn đối tượng: `Files`, `Folders`, hoặc `Both`.
  - Chế độ quét: 1 tầng hoặc đệ quy kèm giới hạn `max_depth`, bỏ qua file/folder ẩn.
  - **Include / Exclude rules:** Lọc theo đuôi file (`.jpg, .png`), mẫu glob/regex (ví dụ loại trừ `info.json`, `cover*`, `*.tmp`).
- **Quy tắc biến đổi (`RenameRule`):**
  - Tìm & Thay thế (`Find & Replace`, hỗ trợ regex & Match Case).
  - Biểu thức Perl Prename: `s/pattern/replacement/flags` (`g`, `i`, `m`, `s`, `x`, `a`), `y/from/to/flags`, hỗ trợ nối chuỗi lệnh bằng `;`.
  - Fixed Presets (chuẩn hóa Chapter/Volume manga, zero-pad `01`/`001`, xóa tag `[...]`, bỏ `_`, chuẩn hóa đuôi, hoa/thường/title) + **User Presets** lưu JSON chuẩn OS (`%APPDATA%` / `~/.config`).
- **Dry-Run Preview & An toàn:**
  - Bảng xem trước gồm **Checkbox chọn từng dòng**, Tên gốc, Tên mới, Phân loại/Đường dẫn, Trạng thái (`Unchanged`, `Pending`, `Conflict`).
  - Phát hiện xung đột tên (kể cả không phân biệt hoa-thường cho Windows/exFAT).
  - Thực thi thư mục **Bottom-Up** (tầng sâu trước) và lưu **`UndoManifest`** để hoàn tác lần đổi tên gần nhất.

### M7. Trải nghiệm Desktop Dùng chung
- Cửa sổ desktop native Windows & Linux (Tauri v2), giao diện phẳng sạch theo [DESIGIN.md](DESIGIN.md).
- Kéo-thả file/folder trực tiếp từ hệ điều hành vào vùng làm việc.
- Hàng đợi/tiến trình nền có **thanh %**, log chi tiết thời gian thực, **nút Hủy (Cancel)** dọn sạch file tạm, và **lịch sử file vừa xuất** (click mở file / mở thư mục chứa).

---

## 3. Ngoài Phạm vi v1 (Out of Scope)

- **Không làm CLI** trong v1 (nhưng lõi `knit-*` tách độc lập để v2 bổ sung CLI nhanh chóng).
- **Không nhúng LibreOffice hoặc Chromium** vào file cài đặt chính để giữ kích thước gọn nhẹ.
- **Không làm trình chỉnh sửa ảnh chuyên sâu** (layer kiểu Photoshop, brush nghệ thuật, chỉnh màu/curve/blur, xóa phông).
- **Không tích hợp giải nén archive phức tạp** (duyệt bên trong/extract file nén kiểu 7-Zip/WinRAR) ở v1 *(có thể bổ sung ở v2 nếu cần)*.
- **Không đồng bộ đám mây / tài khoản / telemetry.**

---

## 4. Yêu cầu Phi chức năng (Non-Functional Requirements)

| Tiêu chí | Mục tiêu |
|---|---|
| **Kích thước bộ cài lõi** | `<= 30 MB` cho `.exe` (NSIS/portable) và `.AppImage` (không tính optional LibreOffice trên máy). |
| **Chạy offline** | 100% tính năng lõi hoạt động không cần mạng Internet. |
| **An toàn dữ liệu** | Không sửa phá hủy file ảnh/PDF gốc khi ghép; ghi output qua `.tmp` + `AtomicOutput`; kiểm tra `free disk space` trước khi xuất lớn. |
| **Tương thích OS** | Windows 10/11 (x86_64) và Linux (x86_64 `.AppImage` / `.deb`); xử lý tên file/ký tự cấm Windows và Unicode NFC chuẩn. |
| **Hiệu năng UI** | Tác vụ nặng chạy trên Rust worker thread/pool, UI luôn mượt khi kéo-thả hàng trăm thumbnail. |
