import { describe, expect, it } from "vitest";
import { formatHomePath, splitDisplayPdfPath } from "./pathDisplay";

describe("pathDisplay", () => {
  it("shortens Linux home paths to ~ and keeps full filename separate", () => {
    const res = splitDisplayPdfPath("/home/khoa/Downloads/Konosuba.pdf", "/home/khoa");
    expect(res.fullDisplay).toBe("~/Downloads/Konosuba.pdf");
    expect(res.dirPart).toBe("~/Downloads/");
    expect(res.fileName).toBe("Konosuba.pdf");
  });

  it("handles home fallback without explicit homeDir and avoids partial username match", () => {
    expect(formatHomePath("/home/khoa/Story/Novel/1.pdf")).toBe("~/Story/Novel/1.pdf");
    expect(formatHomePath("/home/khoa2/Downloads/1.pdf", "/home/khoa")).toBe(
      "/home/khoa2/Downloads/1.pdf",
    );
  });

  it("preserves non-home paths and Windows home paths", () => {
    expect(splitDisplayPdfPath("/opt/books/long/path/guide.pdf", "/home/khoa")).toEqual({
      dirPart: "/opt/books/long/path/",
      fileName: "guide.pdf",
      fullDisplay: "/opt/books/long/path/guide.pdf",
    });
    expect(
      splitDisplayPdfPath("C:\\Users\\Khoa\\Downloads\\Volume 01.pdf", "C:\\Users\\Khoa"),
    ).toEqual({
      dirPart: "~\\Downloads\\",
      fileName: "Volume 01.pdf",
      fullDisplay: "~\\Downloads\\Volume 01.pdf",
    });
  });
});
