# AGENT.md — Hướng dẫn cho Coding Agent làm việc trên Knit

Chào mừng đến với **Knit** — ứng dụng desktop đa năng offline (Windows & Linux) xây dựng bằng **Rust Workspace + Tauri v2 + React/TypeScript**.

---

## 1. Tài liệu Bắt buộc Đọc trước khi Viết Code
1. [PRD.md](PRD.md) — Yêu cầu sản phẩm và phạm vi Out-of-scope v1.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — Kiến trúc crates, luồng IPC, Data flow.
3. [RULES.md](RULES.md) — Ràng buộc an toàn file, tách lớp, UI & kiểm thử.
4. [docs/glossary.md](docs/glossary.md) — Ngôn ngữ chung (dùng đúng tên type/thuật ngữ này trong code!).
5. [docs/decisions/](docs/decisions/) — Các ADR đã chốt (`ADR-001` đến `ADR-005`).
6. [TASK.md](TASK.md) & [PROGRESS.md](PROGRESS.md) — Lộ trình từng Milestone và trạng thái hiện tại.
7. [DESIGIN.md](DESIGIN.md) — Hệ thống màu sắc, typography và nguyên tắc Flat UI.

---

## 2. Tham chiếu Nghiệp vụ Cũ (`MangamentTools`)
Khi triển khai `knit-manga`, `knit-pdf` (phần quét cây bookmark/ảnh động) và `knit-renamer`, có thể tham khảo hành vi chuẩn từ mã nguồn Python gốc tại:
- `/home/khoa/Code/Project/Mangament/tool/app/tools/zip_pack/` (`scanner.py`, `naming.py`, `csv_builder.py`, `packer.py`)
- `/home/khoa/Code/Project/Mangament/tool/app/tools/image2pdf/` (`scanner.py`, `bookmarks.py`, `imaging.py`, `packer.py`)
- `/home/khoa/Code/Project/Mangament/tool/app/tools/renamer/` (`engine.py`, `scanner.py`, `presets.py`, `renamer.py`)

> Lưu ý: Chỉ dùng để đối chiếu **hành vi nghiệp vụ và schema đầu ra** (`stories.csv`, cây bookmark, cú pháp Perl prename), không bê nguyên kiến trúc Python vào Rust.

---

## 3. Quy tắc Làm việc của Agent
- **Thực thi theo thứ tự Milestone:** Không nhảy cóc sang viết tính năng UI trước khi hoàn thành **Milestone 0 (Technical Spikes)** để xác nhận tính khả thi cross-compile của AVIF, PDF crate, Typst và AppImage trên Linux/Windows.
- **Giữ thuật ngữ thống nhất:** Dùng đúng tên khái niệm trong [docs/glossary.md](docs/glossary.md) (`PageDraft`, `BookmarkNode`, `ScanFilter`, `RenamePlan`, `MangamentPackageMode`, `AtomicOutput`...).
- **Cập nhật trạng thái sau mỗi task:** Đánh dấu tiến độ trong [PROGRESS.md](PROGRESS.md) và ghi ADR mới vào `docs/decisions/` nếu có thay đổi kiến trúc đáng kể.
- **Xử lý phản hồi & Review:** Khi người dùng cung cấp nhận xét trong `user-review/version-1-X.md`, bắt buộc kích hoạt skill [knit-review-cycle](.agents/skills/knit-review-cycle/SKILL.md) để tuân thủ quy trình 5 bước (Intake & Clarify → Plan → Safe Implementation → 4-step Gate → `version-1-X.agent-response.md`).
- **Hiệu năng & Quản lý Bộ nhớ:** Khi xử lý ảnh/PDF dung lượng lớn (GB+), render thumbnail, tối ưu concurrency hoặc đo đạc RAM, tuân thủ cẩm nang và checklist trong [knit-perf-and-memory](.agents/skills/knit-perf-and-memory/SKILL.md) (streaming chunk, `HAYRO_PDF_CACHE`, `LosslessPassthrough`, tách semaphore preview/thumbnail, LIFO queue, PSS measurement, `malloc_trim(0)`).
- **Cổng kiểm thử & Đảm bảo chất lượng (QA Gate):** Trước khi commit, tạo release build hoặc sau mỗi đợt refactor/review lớn, kích hoạt skill [knit-qa-gate](.agents/skills/knit-qa-gate/SKILL.md) để chạy đủ 5 pha kiểm tra (`cargo test --workspace`, `cargo check -p knit-desktop`, `pnpm build`, `pnpm test`, và audit tuân thủ `RULES.md`).
