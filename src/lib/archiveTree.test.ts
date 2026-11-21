import { describe, expect, it } from "vitest";
import {
  buildArchiveTreeFromEntries,
  countArchiveFilesAndBytes,
  deleteArchiveNodeAtPath,
  flattenArchiveTreeToEntries,
  moveArchiveNode,
} from "./archiveTree";
import type { ArchiveEntrySpec } from "../types/ipc";

describe("archiveTree helpers", () => {
  const sampleEntries: ArchiveEntrySpec[] = [
    { source_path: "/src/docs/readme.md", archive_path: "docs/readme.md", size_bytes: 120 },
    { source_path: "/src/docs/guide.pdf", archive_path: "docs/guide.pdf", size_bytes: 400 },
    { source_path: "/src/root.txt", archive_path: "root.txt", size_bytes: 80 },
  ];

  it("builds a folder/file tree, aggregates folder sizes, and flattens back accurately", () => {
    const tree = buildArchiveTreeFromEntries(sampleEntries);
    expect(tree).toHaveLength(2);
    expect(tree[0].kind).toBe("folder");
    expect(tree[0].name).toBe("docs");
    expect(tree[0].sizeBytes).toBe(520);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[1].kind).toBe("file");
    expect(tree[1].name).toBe("root.txt");

    expect(countArchiveFilesAndBytes(tree)).toEqual({ fileCount: 3, totalBytes: 600 });
    expect(flattenArchiveTreeToEntries(tree).map((e) => e.archive_path)).toEqual([
      "docs/readme.md",
      "docs/guide.pdf",
      "root.txt",
    ]);
  });

  it("deletes files or folders and updates remaining sizes and flattened entries", () => {
    const tree = buildArchiveTreeFromEntries(sampleEntries);
    const afterDeleteFile = deleteArchiveNodeAtPath(tree, [0, 1]); // delete docs/guide.pdf
    expect(afterDeleteFile[0].sizeBytes).toBe(120);
    expect(flattenArchiveTreeToEntries(afterDeleteFile).map((e) => e.archive_path)).toEqual([
      "docs/readme.md",
      "root.txt",
    ]);

    const afterDeleteFolder = deleteArchiveNodeAtPath(tree, [0]); // delete entire docs folder
    expect(afterDeleteFolder).toHaveLength(1);
    expect(flattenArchiveTreeToEntries(afterDeleteFolder).map((e) => e.archive_path)).toEqual([
      "root.txt",
    ]);
  });

  it("moves files into folders, across levels, and deduplicates name collisions", () => {
    const tree = buildArchiveTreeFromEntries(sampleEntries);
    // Move root.txt ([1]) inside docs ([0])
    const movedIn = moveArchiveNode(tree, [1], [0], "inside");
    expect(movedIn).toHaveLength(1);
    expect(movedIn[0].sizeBytes).toBe(600);
    expect(flattenArchiveTreeToEntries(movedIn).map((e) => e.archive_path)).toEqual([
      "docs/readme.md",
      "docs/guide.pdf",
      "docs/root.txt",
    ]);

    // Move docs/readme.md ([0, 0]) after docs ([0]) -> moves to root level
    const movedOut = moveArchiveNode(movedIn, [0, 0], [0], "after");
    expect(flattenArchiveTreeToEntries(movedOut).map((e) => e.archive_path)).toEqual([
      "docs/guide.pdf",
      "docs/root.txt",
      "readme.md",
    ]);

    // Prevent dropping a folder inside itself
    expect(moveArchiveNode(movedIn, [0], [0, 1], "before")).toBe(movedIn);
  });
});
