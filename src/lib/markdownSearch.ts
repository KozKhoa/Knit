export interface SourceRange {
  from: number;
  to: number;
}

export function findAllTextMatches(
  haystack: string,
  needle: string,
  caseSensitive = false,
): SourceRange[] {
  if (!needle) return [];
  const src = caseSensitive ? haystack : haystack.toLowerCase();
  const q = caseSensitive ? needle : needle.toLowerCase();
  const matches: SourceRange[] = [];
  let idx = 0;
  while (idx <= src.length - q.length) {
    const found = src.indexOf(q, idx);
    if (found === -1) break;
    matches.push({ from: found, to: found + q.length });
    idx = found + Math.max(1, q.length);
  }
  return matches;
}

/**
 * Resolves plain text selected in PDF preview back to exact character offsets inside Markdown source,
 * tolerating inline Markdown syntax (*, _, `, #, >, [text](url), task checkboxes, and line wraps).
 */
export function findMarkdownSourceRange(
  markdown: string,
  selectedText: string,
  occurrenceIndex = 0,
): SourceRange | null {
  const trimmed = selectedText.trim();
  if (!trimmed || !markdown) return null;

  // 1. Exact match when looking for the first occurrence (or only one exists)
  if (occurrenceIndex <= 0) {
    const exactIdx = markdown.indexOf(trimmed);
    if (exactIdx !== -1 && markdown.indexOf(trimmed, exactIdx + 1) === -1) {
      return { from: exactIdx, to: exactIdx + trimmed.length };
    }
  }

  // 2. Build stripped plain-text index mapping back to original Markdown indices
  const strippedChars: string[] = [];
  const origIndices: number[] = [];

  const pushChar = (ch: string, origIdx: number) => {
    const normalized = /\s/.test(ch) ? " " : ch.toLowerCase();
    if (normalized === " " && strippedChars[strippedChars.length - 1] === " ") {
      return;
    }
    strippedChars.push(normalized);
    origIndices.push(origIdx);
  };

  let i = 0;
  while (i < markdown.length) {
    const ch = markdown[i];

    // Skip link target part ](url) while keeping visible [label]
    if (ch === "]" && markdown[i + 1] === "(") {
      const closeParen = markdown.indexOf(")", i + 2);
      const nextNewline = markdown.indexOf("\n", i + 2);
      if (closeParen !== -1 && (nextNewline === -1 || closeParen < nextNewline)) {
        i = closeParen + 1;
        continue;
      }
    }

    // Skip task list markers at start of list item: - [ ] / * [x]
    if (
      (i === 0 || markdown[i - 1] === "\n") &&
      /^\s{0,4}[-*+]\s+\[[ xX]\]\s+/.test(markdown.slice(i))
    ) {
      const m = markdown.slice(i).match(/^\s{0,4}[-*+]\s+\[[ xX]\]\s+/);
      if (m) {
        i += m[0].length;
        continue;
      }
    }

    // Skip markdown heading hashes or blockquote markers at line start
    if (
      (i === 0 || markdown[i - 1] === "\n") &&
      /^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/.test(markdown.slice(i))
    ) {
      const m = markdown.slice(i).match(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/);
      if (m) {
        i += m[0].length;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "`" || ch === "~" || ch === "[" || ch === "]") {
      i += 1;
      continue;
    }

    if (ch === "\\" && i + 1 < markdown.length && /[\\`*_{}[\]()#+\-.!<>]/.test(markdown[i + 1])) {
      pushChar(markdown[i + 1], i + 1);
      i += 2;
      continue;
    }

    pushChar(ch, i);
    i += 1;
  }

  const stripped = strippedChars.join("");
  const needle = trimmed.replace(/\s+/g, " ").toLowerCase();
  const allPositions: number[] = [];
  let scanIdx = 0;
  while (scanIdx <= stripped.length - needle.length) {
    const found = stripped.indexOf(needle, scanIdx);
    if (found === -1) break;
    allPositions.push(found);
    scanIdx = found + Math.max(1, needle.length);
  }

  if (allPositions.length > 0) {
    const pickedIdx = Math.min(Math.max(0, occurrenceIndex), allPositions.length - 1);
    const pos = allPositions[pickedIdx];
    const startOrig = origIndices[pos];
    const endOrig = origIndices[Math.min(origIndices.length - 1, pos + needle.length - 1)] + 1;
    return { from: startOrig, to: endOrig };
  }

  // 3. Fallback: try first 5+ significant words if PDF selection spanned across complex blocks
  const words = needle.split(" ").filter(Boolean);
  if (words.length >= 4) {
    const subNeedle = words.slice(0, Math.min(5, words.length)).join(" ");
    const subPos = stripped.indexOf(subNeedle);
    if (subPos !== -1) {
      const startOrig = origIndices[subPos];
      const endOrig = origIndices[Math.min(origIndices.length - 1, subPos + subNeedle.length - 1)] + 1;
      return { from: startOrig, to: endOrig };
    }
  }

  // 4. Case-insensitive fallback on raw markdown
  const lowerIdx = markdown.toLowerCase().indexOf(trimmed.toLowerCase());
  if (lowerIdx !== -1) {
    return { from: lowerIdx, to: lowerIdx + trimmed.length };
  }

  return null;
}
