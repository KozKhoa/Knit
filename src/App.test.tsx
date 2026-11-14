// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ExportSuccessToast } from "./components/ExportSuccessToast";
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

    // Switch layout to A4 via custom Select so background & padding unit controls appear and persist
    const layoutSelect = screen.getByRole("combobox", { name: "Khổ trang & Nền PDF" });
    fireEvent.click(layoutSelect);
    fireEvent.click(screen.getByRole("option", { name: "Vừa khổ A4" }));
    expect(screen.getByRole("combobox", { name: "Màu nền:" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Padding unit" })).toBeTruthy();

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

    // Custom Slider does not apply while dragging, commits on pointerUp
    const slider = screen.getByRole("slider", { name: "Kích thước chữ ứng dụng" });
    slider.getBoundingClientRect = () =>
      ({ left: 0, right: 100, width: 100, top: 0, bottom: 24, height: 24, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
    fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, clientX: 86 }));
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("16px");
    expect(slider.getAttribute("aria-valuenow")).toBe("19");
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientX: 86 }));
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("19px");

    // Custom NumberInput adjusts via wheel ONLY when focused
    const numInput = screen.getByRole("spinbutton", { name: "Font size px" });
    fireEvent.wheel(numInput, { deltaY: -100 });
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("19px");
    numInput.focus();
    fireEvent.wheel(numInput, { deltaY: -100 });
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("20px");

    fireEvent.click(screen.getByRole("button", { name: "18px" }));
    expect(document.documentElement.style.getPropertyValue("--knit-app-font-size")).toBe("18px");

    // Test collapsible sidebar toggle
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn thanh bên" }));
    expect(screen.getByRole("button", { name: "Mở rộng thanh bên" })).toBeTruthy();

    // Switch back to Image2Pdf and verify mounted state (fit_a4) was preserved
    fireEvent.click(screen.getByRole("button", { name: /Ảnh sang PDF/i }));
    expect(screen.getByRole("combobox", { name: "Màu nền:" }).textContent).toContain("Trắng");
  });

  it("switches language between Vietnamese and English cleanly via Settings", () => {
    render(<App />);
    expect(screen.getByText("Chuyển Ảnh sang PDF & Biên tập Trang")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cài đặt" }));
    fireEvent.click(screen.getByRole("button", { name: "English (EN)" }));
    expect(screen.getByText("Appearance & Application Settings")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tiếng Việt (VI)" }));
    expect(screen.getByText("Cài đặt Giao diện & Hệ thống")).toBeTruthy();
  });

  it("renders ExportSuccessToast at bottom-right, pauses on hover, and auto-closes after 3s", () => {
    vi.useFakeTimers();
    let closed = false;
    render(
      <I18nProvider>
        <ExportSuccessToast
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

    const toast = screen.getByRole("status");
    expect(screen.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeTruthy();
    expect(screen.getByText("/tmp/output.pdf")).toBeTruthy();

    // Hover pauses auto-close beyond 3s
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(closed).toBe(false);

    // Mouse leave resumes 3s timer
    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(closed).toBe(true);
    vi.useRealTimers();
  });

  it("formats byte sizes consistently", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
