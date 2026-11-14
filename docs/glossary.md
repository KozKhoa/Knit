# Knit — Domain Glossary (Từ điển Miền Nghiệp vụ)

Tài liệu này định nghĩa **Ngôn ngữ Chung (Ubiquitous Language)** cho toàn bộ dự án **Knit**. Mọi module Rust (`knit-*`), giao diện React/TypeScript, unit test và tài liệu phải dùng thống nhất các khái niệm dưới đây.

---

## 1. Khái niệm Dùng chung (Shared Workspace & Jobs)

| Thuật ngữ | Định nghĩa chuẩn | Ghi chú kỹ thuật |
|---|---|---|
| **ToolModule** | Một trong 6 phân hệ chức năng chính của Knit (`image2pdf`, `pdf_ops`, `doc2pdf`, `archive`, `manga_pack`, `renamer`). | Giao tiếp qua Tauri commands và chạy tác vụ nặng trên background task. |
| **WorkspaceJob** | Một phiên thực thi tác vụ (chuyển đổi, ghép, nén, đổi tên) có trạng thái, tiến độ, log và khả năng hủy. | Trả về `JobId`, phát sự kiện `JobProgress` & `JobLog`. |
| **CancellationToken** | Cơ chế tín hiệu hủy an toàn giữa UI và lõi Rust. | Khi kích hoạt, worker dừng ở ranh giới bước gần nhất và dọn sạch file `.tmp` / `.part`. |
| **AtomicOutput** | Quy ước ghi file ra tên tạm (`.tmp` / `.part`), chỉ `rename/replace` sang file đích khi thành công 100%. | Nếu lỗi hoặc bị hủy, file dở dang bị xóa để không để lại output hỏng. |
| **NaturalSortKey** | Khóa sắp xếp tự nhiên theo số học trong chuỗi (ví dụ `2` < `10`, `ch 1.5` < `ch 2`), không phân biệt hoa thường. | Dùng thống nhất khi quét ảnh, chương manga và danh sách rename. |

---

## 2. Miền Image → PDF & PDF Operations

| Thuật ngữ | Định nghĩa chuẩn | Ghi chú kỹ thuật |
|---|---|---|
| **PageSource** | Nguồn gốc đầu vào của một trang trong danh sách ghép: có thể là file ảnh (`jpg`, `png`, `webp`, `avif`, `gif`, `bmp`, `tiff`) hoặc 1 trang trích từ file PDF có sẵn (`PdfPageRef`). | Không bao giờ chỉnh sửa trực tiếp file nguồn trên đĩa. |
| **PageDraft** | Bản nháp không phá hủy (non-destructive) đại diện cho 1 trang trước khi xuất PDF. Chứa: tham chiếu `PageSource`, góc xoay (`0/90/180/270`), vùng `CropRect`, danh sách `AnnotationLayer`, thiết lập khổ trang và trạng thái chọn/xóa. | UI chỉnh sửa `PageDraft` trực tiếp; lõi Rust chỉ render/composite khi bấm Export. |
| **CropRect** | Hình chữ nhật cắt vùng ảnh theo tọa độ chuẩn hóa `[0.0, 1.0]` (tương đối theo ảnh sau xoay) để không phụ thuộc độ phân giải hiển thị thumbnail. | Dễ serialize giữa Canvas và Rust exporter. |
| **AnnotationLayer** | Tập hợp các lớp vẽ/chữ chồng lên trang ảnh, gồm `TextAnnotation` (nội dung, tọa độ, font, cỡ chữ, màu) và `StrokeAnnotation` (tập điểm nét vẽ vector, độ dày, màu). | Lưu dạng vector tương đối theo vùng crop; chỉ rasterize khi xuất PDF. |
| **LosslessPassthrough** | Đường đi tối ưu (fast-path) khi trang là JPEG/PNG hợp lệ, không xoay EXIF cần xử lý, không crop và không có `AnnotationLayer`: nhúng byte gốc vào PDF không nén lại. | Kế thừa triết lý `img2pdf` của `MangamentTools`. |
| **BookmarkNode** | Một nút trong cây mục lục PDF (`/Outlines`), gồm `title`, trang bắt đầu/kết thúc hoặc `target_page_id`, và `children` lồng cấp. | Có thể sinh tự động từ cây thư mục hoặc tạo/kéo-thả/sửa tay trên UI. |
| **PageLayoutPolicy** | Quy tắc đặt ảnh vào trang PDF: `OriginalSize` (1px = 1pt, giới hạn ISO 32000-1 `[3.0, 14400.0]` pt cho webtoon), `FitA4`, `FitLetter`, kèm margin & căn giữa. | Tránh lỗi vượt kích thước trang chuẩn PDF với ảnh scan quá dài. |
| **AnimatedImagePolicy** | Cách xử lý GIF/WebP động khi đưa vào PDF: `FirstFrameOnly` (chỉ lấy khung đầu) hoặc `UnpackFrames` (tách từng frame thành trang kèm `/Dur` và giới hạn `max_frames`). | Tương ứng tùy chọn `unpack_gif` ở `MangamentTools`. |
| **PdfSplitRule** | Quy tắc tách PDF: `PageRanges` (`1-3, 5, 8-12`), `EveryNPages`, `ExtractSelected`, hoặc `MaxBytes` (chia part theo MB giống `split_indices`). | Khi tách theo part hoặc bỏ trang lỗi, dùng `remap_tree` để cập nhật lại `BookmarkNode`. |

---

## 3. Miền Document → PDF

| Thuật ngữ | Định nghĩa chuẩn | Ghi chú kỹ thuật |
|---|---|---|
| **DocumentFormat** | Định dạng tài liệu nguồn: nhóm **Core Native** (`md`, `html`, `epub`, `txt`) và nhóm **Office External** (`docx`, `pptx`). | Phân nhóm theo ADR-002 để giữ bộ cài gốc gọn nhẹ. |
| **ConversionEngine** | Bộ máy chuyển đổi thực thi: `NativeTypst`, `NativeHtmlPipeline`, hoặc `ExternalOffice` (LibreOffice `soffice` headless / bộ cài ngoài phát hiện được). | UI hiển thị rõ engine nào đang dùng cho từng định dạng. |
| **EngineStatus** | Trạng thái của `ExternalOffice` trên máy người dùng: `Ready(path, version)`, `NotFound`, hoặc `Downloading`. | Cho phép chỉ định đường dẫn thủ công hoặc tải gói hỗ trợ khi người dùng cần `docx`/`pptx`. |

---

## 4. Miền Archive & Manga Packager

| Thuật ngữ | Định nghĩa chuẩn | Ghi chú kỹ thuật |
|---|---|---|
| **ArchiveFormat** | Định dạng nén được hỗ trợ: `Zip`, `Cbz`, `Tar`, `TarGz` (`.tar.gz`), `TarZst` (`.tar.zst`). | ZIP hỗ trợ mật khẩu; TAR giữ cấu trúc đường dẫn POSIX chuẩn. |
| **ZipEncryption** | Cơ chế mã hóa mật khẩu cho file ZIP: `None`, `Aes256` (khuyến nghị), `ZipCrypto` (tương thích giải nén cũ). | Cảnh báo rõ độ an toàn giữa AES-256 và ZipCrypto trên UI. |
| **MangaScanMode** | Chế độ quét nguồn manga: `Auto` (tự nhận diện 1 truyện hay thư viện nhiều truyện), `SingleStory`, `Library`. | Kế thừa heuristic `looks_like_single_story` từ `zip_pack`. |
| **Story** | Đại diện 1 bộ truyện trên đĩa, gồm `dir_name`, `StoryInfo` (tùy chọn từ `info.json`), `cover` (ảnh bìa), danh sách `Chapter` và `warnings`. | Tên dùng chuẩn hóa NFC Unicode để không lỗi regex tiếng Việt trên file tạo từ macOS. |
| **NodeRef** | Một cấp phân cấp trong cấu trúc truyện: `type` (`volume` \| `arc` \| `chapter`), `order_index` (`f64`, hỗ trợ `1.5`), `title`. | Parse từ tên thư mục (`Vol.2`, `Chương 10`, `05`...) theo `naming.py`. |
| **MangamentPackageMode** | Tùy chọn bật chế độ xuất tương thích hệ thống **Mangament Server**: đọc `info.json`, nhúng `info.json` vào ZIP và tự sinh `stories.csv` (RFC 4180). | Tắt mặc định cho người dùng phổ thông; bật khi người dùng đóng gói cho Mangament. |

---

## 5. Miền Batch Renamer

| Thuật ngữ | Định nghĩa chuẩn | Ghi chú kỹ thuật |
|---|---|---|
| **ScanFilter** | Bộ lọc xác định file/folder nào được đưa vào kế hoạch đổi tên: `target_type` (`Files` \| `Folders` \| `Both`), `recursive`, `max_depth`, `include_patterns`, `exclude_patterns`, `extensions`, `ignore_hidden`. | Giải quyết triệt để yêu cầu lọc *"cái nào nên đổi, cái nào không"*. |
| **RenameRule** | Quy tắc biến đổi tên: `FindReplace`, `PerlPrename` (`s/pattern/repl/flags`, `y/from/to/flags`, hỗ trợ nối nhiều lệnh bằng `;`), `FixedPreset`, hoặc `UserPreset`. | Kế thừa đầy đủ `PrenameEngine` & `FIXED_PRESETS` của `MangamentTools`. |
| **RenameItem** | Một đối tượng trong kết quả xem trước, gồm `original_path`, `new_name`, `new_path`, `is_dir`, `depth`, `selected: bool` (checkbox trên bảng Preview) và `RenameStatus`. | Chỉ thực thi các dòng có `selected == true` và `status == Pending`. |
| **RenamePlan** | Kế hoạch Dry-Run hoàn chỉnh trước khi ghi đĩa, đã chạy **Collision Detection** (trùng tên đích, trùng không phân biệt hoa-thường cho Windows) và sắp xếp **Bottom-Up** (đổi folder sâu trước). | Ngăn lỗi đổi tên thư mục cha làm mất đường dẫn con. |
| **UndoManifest** | Bản ghi JSON lưu cặp `(new_path -> original_path)` của lần đổi tên đã chạy thành công, xếp ngược thứ tự thực thi để khôi phục an toàn. | Lưu trong thư mục config/data chuẩn của OS. |
