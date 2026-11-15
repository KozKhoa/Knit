import { describe, expect, it } from "vitest";
import { hasPageEdits, pageEditSignature, sortPageDrafts } from "./imageSort";
import type { PageDraft } from "../types/ipc";

function makeDraft(
  id: string,
  path: string,
  fileSizeBytes: number,
  rotationDeg = 0,
): PageDraft {
  return {
    id,
    label: path.split("/").pop() ?? id,
    source: { kind: "image_file", path },
    width_px: 800,
    height_px: 1200,
    duration_ms: null,
    file_size_bytes: fileSizeBytes,
    rotation_deg: rotationDeg,
    crop: null,
    annotations: { strokes: [], texts: [] },
  };
}

describe("imageSort helpers", () => {
  it("sorts naturally by name, size, type, and import_order in both directions", () => {
    const a = makeDraft("a", "/tmp/page2.png", 3000);
    const b = makeDraft("b", "/tmp/page10.jpg", 1000);
    const c = makeDraft("c", "/tmp/page1.webp", 2000);
    const importMap = { a: 2, b: 1, c: 3 };

    expect(sortPageDrafts([a, b, c], "manual", "asc", importMap).map((p) => p.id)).toEqual([
      "a",
      "b",
      "c",
    ]);

    expect(
      sortPageDrafts([a, b, c], "import_order", "asc", importMap).map((p) => p.id),
    ).toEqual(["b", "a", "c"]);
    expect(
      sortPageDrafts([a, b, c], "import_order", "desc", importMap).map((p) => p.id),
    ).toEqual(["c", "a", "b"]);

    expect(sortPageDrafts([a, b, c], "name", "asc", importMap).map((p) => p.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(sortPageDrafts([a, b, c], "name", "desc", importMap).map((p) => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);

    expect(sortPageDrafts([a, b, c], "size", "asc", importMap).map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortPageDrafts([a, b, c], "size", "desc", importMap).map((p) => p.id)).toEqual([
      "a",
      "c",
      "b",
    ]);

    expect(sortPageDrafts([a, b, c], "type", "asc", importMap).map((p) => p.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("detects edits and produces distinct edit signatures", () => {
    const base = makeDraft("x", "/tmp/img.png", 500, 0);
    expect(hasPageEdits(base)).toBe(false);

    const rotated = { ...base, rotation_deg: 90 };
    expect(hasPageEdits(rotated)).toBe(true);
    expect(pageEditSignature(rotated)).not.toBe(pageEditSignature(base));

    const cropped = {
      ...base,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
    };
    expect(hasPageEdits(cropped)).toBe(true);
    expect(pageEditSignature(cropped)).not.toBe(pageEditSignature(base));
  });
});
