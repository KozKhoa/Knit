import { describe, expect, it } from "vitest";
import { joinDirAndFile, normalizeOutputFilename } from "./exportPath";

describe("exportPath helpers", () => {
  it("joins directory and filename across POSIX and Windows separators", () => {
    expect(joinDirAndFile("/home/user/out/", "merged.pdf")).toBe(
      "/home/user/out/merged.pdf",
    );
    expect(joinDirAndFile("C:\\Users\\khoa\\Out\\", "book.zip")).toBe(
      "C:\\Users\\khoa\\Out\\book.zip",
    );
    expect(joinDirAndFile("", "file.pdf")).toBe("file.pdf");
  });

  it("normalizes and appends missing extensions safely", () => {
    expect(normalizeOutputFilename("my_doc", "document.pdf", ["pdf"])).toBe(
      "my_doc.pdf",
    );
    expect(normalizeOutputFilename("my_doc.PDF", "document.pdf", ["pdf"])).toBe(
      "my_doc.PDF",
    );
    expect(normalizeOutputFilename("", "archive.tar.gz", ["tar.gz"])).toBe(
      "archive.tar.gz",
    );
    expect(normalizeOutputFilename("bad/name:file", "out.zip", ["zip", "cbz"])).toBe(
      "bad_name_file.zip",
    );
    expect(normalizeOutputFilename("comic.cbz", "out.zip", ["zip", "cbz"])).toBe(
      "comic.cbz",
    );
  });
});
