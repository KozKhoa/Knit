import { describe, expect, it } from "vitest";
import { findAllTextMatches, findMarkdownSourceRange } from "./markdownSearch";
import { extractMermaidSources } from "./mermaid";

describe("extractMermaidSources", () => {
  it("extracts unique mermaid fenced blocks and ignores non-mermaid fences", () => {
    const md = [
      "# Title",
      "```rust",
      "fn main() {}",
      "```",
      "```mermaid",
      "graph TD",
      "A --> B",
      "```",
      "```mermaid",
      "graph TD",
      "A --> B",
      "```",
      "~~~mermaid",
      "sequenceDiagram",
      "Alice->>Bob: Hi",
      "~~~",
    ].join("\n");

    expect(extractMermaidSources(md)).toEqual([
      "graph TD\nA --> B",
      "sequenceDiagram\nAlice->>Bob: Hi",
    ]);
  });
});

describe("markdownSearch helpers", () => {
  it("finds all case-insensitive occurrences in text", () => {
    const matches = findAllTextMatches("Hello world, hello Knit!", "hello");
    expect(matches).toEqual([
      { from: 0, to: 5 },
      { from: 13, to: 18 },
    ]);
  });

  it("maps plain text selected from PDF back to markdown source across formatting", () => {
    const md = [
      "### **Definition of Done (DoD)**",
      "",
      "* [ ] Dữ liệu **sinh viên** _FIT_ HCMUS",
      "* [x] Xem [tài liệu nội bộ](https://fit.hcmus.edu.vn)",
    ].join("\n");

    const r1 = findMarkdownSourceRange(md, "Dữ liệu sinh viên FIT HCMUS");
    expect(r1).not.toBeNull();
    expect(md.slice(r1!.from, r1!.to)).toContain("sinh viên");

    const r2 = findMarkdownSourceRange(md, "Xem tài liệu nội bộ");
    expect(r2).not.toBeNull();
    expect(md.slice(r2!.from, r2!.to)).toContain("tài liệu nội bộ");
  });
});
