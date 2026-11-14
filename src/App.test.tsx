// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { ExportSuccessModal } from "./components/ExportSuccessModal";
import { I18nProvider } from "./i18n";
import { formatBytes } from "./lib/ipc";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("Knit Workbench UI", () => {
  it("renders all 6 tool navigation items with accented Vietnamese and preserves tool state", () => {
    render(<App />);

    expect(screen.getByText("Chuyển Ảnh sang PDF & Biên tập Trang")).toBeTruthy();

    // Switch layout to A4 so background & padding unit controls appear and persist
    const layoutSelect = screen.getByDisplayValue("Kích thước ảnh gốc (DPI)") as HTMLSelectElement;
    fireEvent.change(layoutSelect, { target: { value: "fit_a4" } });
    expect(screen.getByLabelText("Màu nền:")).toBeTruthy();
    expect(screen.getByLabelText("Padding unit")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Gộp & Tách PDF/i }));
    expect(screen.getByText("Chọn hoặc kéo thả các tệp PDF cần gộp")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tài liệu sang PDF/i }));
    expect(
      screen.getByText("Chọn hoặc kéo thả tài liệu (.md, .txt, .html, .epub, .docx, .pptx)"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Giao diện (Theme)")).toBeTruthy();
    expect(screen.getByLabelText("Font PDF")).toBeTruthy();
    expect(screen.getByText("Soạn thảo Markdown / Văn bản")).toBeTruthy();
    expect(screen.getByText("Xem trước PDF trực tiếp")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Nén Archive/i }));
    expect(screen.getByRole("button", { name: "Đóng gói Archive" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Đóng gói Manga/i }));
    expect(screen.getByText("MangamentPackageMode")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Đổi tên hàng loạt/i }));
    expect(screen.getByText("Lớp 1: Bộ lọc quét (ScanFilter)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cài đặt" }));
    expect(screen.getByText("Cài đặt Giao diện & Hệ thống")).toBeTruthy();

    // Test font & font size settings update CSS variables
    fireEvent.click(screen.getByRole("button", { name: /Afacad/i }));
    expect(document.documentElement.style.getPropertyValue("--knit-font-sans")).toContain("Afacad");
    fireEvent.click(screen.getByRole("button", { name: "18px" }));
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("18px");

    // Test collapsible sidebar toggle
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn thanh bên" }));
    expect(screen.getByRole("button", { name: "Mở rộng thanh bên" })).toBeTruthy();

    // Switch back to Image2Pdf and verify mounted state (fit_a4) was preserved
    fireEvent.click(screen.getByRole("button", { name: /Ảnh sang PDF/i }));
    expect((screen.getByLabelText("Màu nền:") as HTMLSelectElement).value).toBe("white");
  });

  it("switches language between Vietnamese and English cleanly", () => {
    render(<App />);
    expect(screen.getByText("Chuyển Ảnh sang PDF & Biên tập Trang")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(screen.getByText("Image to PDF & Canvas Editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "vi" }));
    expect(screen.getByText("Chuyển Ảnh sang PDF & Biên tập Trang")).toBeTruthy();
  });

  it("renders ExportSuccessModal when completed result is provided", () => {
    let closed = false;
    render(
      <I18nProvider>
        <ExportSuccessModal
          result={{
            title: "Ảnh sang PDF",
            summary: "Đã xuất 5 trang vào 1 tệp PDF.",
            outputs: ["/tmp/output.pdf"],
          }}
          onClose={() => {
            closed = true;
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeTruthy();
    expect(screen.getByText("/tmp/output.pdf")).toBeTruthy();
    fireEvent.click(screen.getByText("Đóng"));
    expect(closed).toBe(true);
  });

  it("formats byte sizes consistently", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
