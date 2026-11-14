export type MermaidTheme = "default" | "neutral" | "forest" | "dark" | "base";

export const MERMAID_THEMES: MermaidTheme[] = [
  "default",
  "neutral",
  "forest",
  "dark",
  "base",
];

/**
 * Extracts unique normalized Mermaid fenced code blocks from Markdown source.
 * Mirrors CommonMark fenced blocks (```mermaid or ~~~mermaid) using matching closing fences.
 */
export function extractMermaidSources(markdown: string): string[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const seen = new Set<string>();
  const out: string[] = [];

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let isMermaid = false;
  let buf: string[] = [];

  for (const line of lines) {
    if (!inFence) {
      const m = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
      if (m) {
        fenceChar = m[1][0];
        fenceLen = m[1].length;
        const info = m[2].trim();
        // CommonMark rejects backtick info strings containing backticks
        if (fenceChar === "`" && info.includes("`")) continue;
        inFence = true;
        const lang = info.split(/\s+/)[0]?.toLowerCase() ?? "";
        isMermaid = lang === "mermaid";
        buf = [];
      }
      continue;
    }

    const closeMatch = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
    if (
      closeMatch &&
      closeMatch[1][0] === fenceChar &&
      closeMatch[1].length >= fenceLen
    ) {
      if (isMermaid) {
        const key = buf.join("\n").trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(key);
        }
      }
      inFence = false;
      isMermaid = false;
      buf = [];
    } else if (isMermaid) {
      buf.push(line);
    }
  }

  return out;
}

let renderSeq = 0;

/**
 * Renders every Mermaid code block found in `markdown` to pure vector SVG (htmlLabels disabled for Typst).
 */
export async function renderMermaidSvgs(
  markdown: string,
  theme: MermaidTheme,
  fallbackCache?: Map<string, string>,
): Promise<Record<string, string>> {
  const sources = extractMermaidSources(markdown);
  if (sources.length === 0) return {};

  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: "loose",
    htmlLabels: false,
    flowchart: { htmlLabels: false, useMaxWidth: false, padding: 14 },
    class: { htmlLabels: false },
    state: { dividerMargin: 10 },
  });

  const result: Record<string, string> = {};
  for (const src of sources) {
    const cacheKey = `${theme}::${src}`;
    const cached = fallbackCache?.get(cacheKey);
    if (cached) {
      result[src] = cached;
      continue;
    }

    const id = `knit_mermaid_${++renderSeq}`;
    try {
      const rendered = await mermaid.render(id, src);
      const cleanSvg = sanitizeMermaidSvgForTypst(rendered.svg);
      result[src] = cleanSvg;
      fallbackCache?.set(cacheKey, cleanSvg);
    } catch {
      // Remove orphan temp node Mermaid creates on syntax errors during live typing
      if (typeof document !== "undefined") {
        document.getElementById(`d${id}`)?.remove();
        document.getElementById(id)?.remove();
      }
    }
  }
  return result;
}

function sanitizeMermaidSvgForTypst(svg: string): string {
  let out = svg.trim();
  if (!out.includes("xmlns=")) {
    out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Remove inline max-width CSS so Typst derives sizing purely from viewBox / attributes
  out = out.replace(/(<svg\b[^>]*?)\sstyle="[^"]*max-width:[^"]*"/i, "$1");
  // Typst's SVG decoder ignores HTML inside <foreignObject>; strip any residual blocks cleanly
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  return out;
}
