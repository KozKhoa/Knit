// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { MangaPackView } from "./MangaPackView";
import type { Story } from "../types/ipc";

const mockScanMangaFolder = vi.fn();
const mockReadDocTextFile = vi.fn();
const mockWriteDocTextFile = vi.fn();
const mockIsTauriRuntime = vi.fn(() => true);

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    isTauriRuntime: () => mockIsTauriRuntime(),
    scanMangaFolder: (...args: unknown[]) => mockScanMangaFolder(...args),
    readDocTextFile: (...args: unknown[]) => mockReadDocTextFile(...args),
    writeDocTextFile: (...args: unknown[]) => mockWriteDocTextFile(...args),
  };
});

const SAMPLE_STORIES: Story[] = [
  {
    dir_name: "Story Alpha",
    path: "/lib/Story Alpha",
    info_file: "info.json",
    cover: "cover.jpg",
    warnings: [],
    info: {
      title: "Story Alpha",
      summary: "Alpha summary",
      genres: ["Action"],
      authors: ["Author A"],
      other_titles: [],
      nation: "Japan",
      nation_id: "jp",
      poster_id: "p1",
      story_type: "manga",
      status: "ongoing",
    },
    chapters: [
      {
        chain: [{ kind: "chapter", order_index: 1, title: "Chapter 1" }],
        folder: "Chapter 1",
        path: "/lib/Story Alpha/Chapter 1",
        images: ["01.jpg", "02.jpg"],
      },
    ],
  },
  {
    dir_name: "Story Beta",
    path: "/lib/Story Beta",
    info_file: null,
    cover: null,
    warnings: [],
    info: null,
    chapters: [
      {
        chain: [{ kind: "chapter", order_index: 1, title: "Chap 01" }],
        folder: "Chap 01",
        path: "/lib/Story Beta/Chap 01",
        images: ["1.jpg", "2.jpg", "3.jpg"],
      },
    ],
  },
];

beforeEach(() => {
  window.localStorage.clear();
  mockIsTauriRuntime.mockReturnValue(true);
  mockScanMangaFolder.mockReset();
  mockReadDocTextFile.mockReset();
  mockWriteDocTextFile.mockReset();
  mockScanMangaFolder.mockResolvedValue(SAMPLE_STORIES);
  mockWriteDocTextFile.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function renderMangaPackWithDroppedFolder() {
  const onStartJob = vi.fn();
  const onJobEvent = vi.fn();
  const onFinishJob = vi.fn();

  const view = render(
    <I18nProvider>
      <MangaPackView
        onStartJob={onStartJob}
        onJobEvent={onJobEvent}
        onFinishJob={onFinishJob}
        busy={false}
        droppedBatch={{ seq: 1, paths: ["/lib"] }}
      />
    </I18nProvider>,
  );
  return view;
}

describe("MangaPackView review fixes (items 5, 6, 7)", () => {
  it("resizes each story tree independently and matches app font size (text-base)", async () => {
    renderMangaPackWithDroppedFolder();

    await waitFor(() => {
      expect(screen.getByText("Chapter 1")).toBeTruthy();
      expect(screen.getByText("Chap 01")).toBeTruthy();
    });

    // Item 5: folder names and page counts use text-base (app font size)
    const chapterNode = screen.getByText("Chapter 1");
    expect(chapterNode.closest(".text-base")).toBeTruthy();
    const pageCountNode = screen.getByText("2p");
    expect(pageCountNode.className).toContain("text-base");

    // Item 7: resizing Story Alpha does not resize Story Beta
    const separators = screen.getAllByRole("separator");
    expect(separators).toHaveLength(2);
    const alphaTreeScroll = separators[0].previousElementSibling as HTMLElement;
    const betaTreeScroll = separators[1].previousElementSibling as HTMLElement;
    expect(alphaTreeScroll.style.height).toBe("220px");
    expect(betaTreeScroll.style.height).toBe("220px");

    act(() => {
      fireEvent(separators[0], new MouseEvent("pointerdown", { bubbles: true, clientY: 100, button: 0 }));
      fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 200 }));
      fireEvent(window, new MouseEvent("pointerup", { bubbles: true, clientY: 200 }));
    });

    expect(alphaTreeScroll.style.height).toBe("320px");
    expect(betaTreeScroll.style.height).toBe("220px");
  });

  it("opens info.json modal with Form + Raw JSON tabs and creates info.json only on Save", async () => {
    renderMangaPackWithDroppedFolder();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Thêm info\.json/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /Sửa info\.json/i })).toBeTruthy();
    });

    // Clicking "Thêm info.json" opens modal without writing to disk yet
    fireEvent.click(screen.getByRole("button", { name: /Thêm info\.json/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(mockWriteDocTextFile).not.toHaveBeenCalled();

    // Edit title & genres in Form tab
    const titleInput = screen.getByLabelText(/Tên truyện/i) as HTMLInputElement;
    expect(titleInput.value).toBe("Story Beta");
    fireEvent.change(titleInput, { target: { value: "Story Beta Edited" } });

    const genresInput = screen.getByLabelText(/Thể loại/i) as HTMLInputElement;
    fireEvent.change(genresInput, { target: { value: "Fantasy, Adventure" } });

    // Switch to Raw JSON tab and verify synced JSON
    fireEvent.click(screen.getByRole("button", { name: "Raw JSON" }));
    const rawEditor = dialog.querySelector(".cm-content") as HTMLElement;
    expect(rawEditor).toBeTruthy();
    expect(rawEditor.textContent).toContain('"title": "Story Beta Edited"');
    expect(rawEditor.textContent).toContain('"Adventure"');

    // Save writes info.json to Story Beta folder and updates the card
    fireEvent.click(screen.getByRole("button", { name: /Lưu info\.json/i }));

    await waitFor(() => {
      expect(mockWriteDocTextFile).toHaveBeenCalledTimes(1);
    });
    expect(mockWriteDocTextFile.mock.calls[0][0]).toBe("/lib/Story Beta/info.json");
    expect(JSON.parse(mockWriteDocTextFile.mock.calls[0][1] as string).title).toBe(
      "Story Beta Edited",
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("Story Beta Edited")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Thêm info\.json/i })).toBeNull();
    });
  });
});
