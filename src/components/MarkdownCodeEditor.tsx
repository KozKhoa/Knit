import React from "react";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { html, htmlLanguage } from "@codemirror/lang-html";
import { css, cssLanguage } from "@codemirror/lang-css";
import {
  javascript,
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { forceLinting, linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import type { SourceRange } from "../lib/markdownSearch";

export type EditorLanguage =
  | "markdown"
  | "html"
  | "css"
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "plain_text";

export const EDITOR_LANGUAGE_OPTIONS: { value: EditorLanguage; label: string; ext: string }[] = [
  { value: "markdown", label: "Markdown", ext: ".md" },
  { value: "html", label: "HTML", ext: ".html" },
  { value: "css", label: "CSS", ext: ".css" },
  { value: "javascript", label: "JavaScript", ext: ".js" },
  { value: "typescript", label: "TypeScript", ext: ".ts" },
  { value: "jsx", label: "JSX", ext: ".jsx" },
  { value: "tsx", label: "TSX", ext: ".tsx" },
  { value: "plain_text", label: "Plain Text", ext: ".txt" },
];

export function editorLanguageExtension(lang: EditorLanguage): string {
  return EDITOR_LANGUAGE_OPTIONS.find((item) => item.value === lang)?.ext ?? ".md";
}

export function detectEditorLanguage(path: string | null, content: string): EditorLanguage {
  if (path) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
    if (lower.endsWith(".css")) return "css";
    if (lower.endsWith(".tsx")) return "tsx";
    if (lower.endsWith(".jsx")) return "jsx";
    if (lower.endsWith(".ts")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
      return "javascript";
    }
    if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".rst")) {
      return "plain_text";
    }
    if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  }

  const trimmed = content.trimStart();
  if (
    /^z?<!doctype\s+html/i.test(trimmed) ||
    /^<(html|head|body|section|div|style|script)\b/i.test(trimmed)
  ) {
    return "html";
  }
  return "markdown";
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function collectHtmlStructuralDiagnostics(docText: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const doctypeMatch = /^([^\s<]{1,16})<!doctype\b/i.exec(docText);
  if (doctypeMatch) {
    diagnostics.push({
      from: 0,
      to: doctypeMatch[1].length,
      severity: "error",
      message: `Stray characters "${doctypeMatch[1]}" before <!DOCTYPE html>`,
    });
  }

  const stack: { tag: string; from: number; to: number }[] = [];
  let i = 0;
  const len = docText.length;

  while (i < len && diagnostics.length < 50) {
    const lt = docText.indexOf("<", i);
    if (lt === -1) break;

    if (docText.startsWith("<!--", lt)) {
      const endComment = docText.indexOf("-->", lt + 4);
      if (endComment === -1) {
        diagnostics.push({
          from: lt,
          to: Math.min(len, lt + 4),
          severity: "error",
          message: "Unclosed HTML comment <!--",
        });
        break;
      }
      i = endComment + 3;
      continue;
    }

    if (docText.startsWith("<!", lt) || docText.startsWith("<?", lt)) {
      const gt = docText.indexOf(">", lt + 2);
      if (gt === -1) {
        diagnostics.push({
          from: lt,
          to: Math.min(len, lt + 2),
          severity: "error",
          message: "Unclosed HTML declaration",
        });
        break;
      }
      i = gt + 1;
      continue;
    }

    // Scan tag until unquoted '>'
    let quote: string | null = null;
    let j = lt + 1;
    while (j < len) {
      const ch = docText[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      } else if (ch === "<") {
        break;
      }
      j += 1;
    }

    if (j >= len || docText[j] !== ">") {
      diagnostics.push({
        from: lt,
        to: Math.min(len, lt + 12),
        severity: "error",
        message: "Unclosed HTML tag '<'",
      });
      i = lt + 1;
      continue;
    }

    const rawTagInner = docText.slice(lt + 1, j).trim();
    i = j + 1;

    if (!rawTagInner) continue;
    const isClosing = rawTagInner.startsWith("/");
    const nameMatch = isClosing
      ? /^\/\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rawTagInner)
      : /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(rawTagInner);
    if (!nameMatch) continue;

    const tagName = nameMatch[1].toLowerCase();
    const isSelfClosing = !isClosing && (rawTagInner.endsWith("/") || VOID_HTML_TAGS.has(tagName));

    if (!isClosing) {
      if (tagName === "script" || tagName === "style") {
        const closeRe = new RegExp(`</${tagName}\\s*>`, "i");
        const closeMatch = closeRe.exec(docText.slice(i));
        if (!closeMatch) {
          diagnostics.push({
            from: lt,
            to: j + 1,
            severity: "error",
            message: `Unclosed <${tagName}> element`,
          });
          break;
        }
        i += closeMatch.index + closeMatch[0].length;
        continue;
      }
      if (!isSelfClosing) {
        stack.push({ tag: tagName, from: lt, to: j + 1 });
      }
    } else {
      const matchIdx = (() => {
        for (let k = stack.length - 1; k >= 0; k -= 1) {
          if (stack[k].tag === tagName) return k;
        }
        return -1;
      })();

      if (matchIdx === -1) {
        diagnostics.push({
          from: lt,
          to: j + 1,
          severity: "error",
          message: `Unexpected closing tag </${tagName}>`,
        });
      } else {
        while (stack.length - 1 > matchIdx && diagnostics.length < 50) {
          const unclosed = stack.pop()!;
          diagnostics.push({
            from: unclosed.from,
            to: unclosed.to,
            severity: "error",
            message: `Unclosed <${unclosed.tag}> tag`,
          });
        }
        stack.pop();
      }
    }
  }

  for (const leftover of stack) {
    if (diagnostics.length >= 50) break;
    diagnostics.push({
      from: leftover.from,
      to: leftover.to,
      severity: "error",
      message: `Unclosed <${leftover.tag}> tag`,
    });
  }

  return diagnostics;
}

function collectMarkdownDiagnostics(docText: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = docText.split("\n");
  let offset = 0;
  let openFence: { marker: string; from: number; to: number } | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const match = /^(```+|~~~+)/.exec(trimmed);
    if (match) {
      const markerChar = match[1][0];
      if (!openFence) {
        openFence = {
          marker: markerChar,
          from: offset,
          to: offset + Math.max(1, line.length),
        };
      } else if (openFence.marker === markerChar) {
        openFence = null;
      }
    }
    offset += line.length + 1;
  }

  if (openFence) {
    diagnostics.push({
      from: openFence.from,
      to: openFence.to,
      severity: "error",
      message: `Unclosed fenced code block (${openFence.marker.repeat(3)})`,
    });
  }
  return diagnostics;
}

export function collectSyntaxDiagnostics(
  docText: string,
  lang: EditorLanguage,
  state?: EditorState,
): Diagnostic[] {
  if (!docText.trim() || lang === "plain_text") return [];

  if (lang === "markdown") {
    return collectMarkdownDiagnostics(docText);
  }

  const diagnostics: Diagnostic[] = [];
  if (lang === "html") {
    diagnostics.push(...collectHtmlStructuralDiagnostics(docText));
  }

  const tree = state
    ? syntaxTree(state)
    : lang === "html"
      ? htmlLanguage.parser.parse(docText)
      : lang === "css"
        ? cssLanguage.parser.parse(docText)
        : lang === "typescript"
          ? typescriptLanguage.parser.parse(docText)
          : lang === "jsx"
            ? jsxLanguage.parser.parse(docText)
            : lang === "tsx"
              ? tsxLanguage.parser.parse(docText)
              : javascriptLanguage.parser.parse(docText);

  let lastEnd = -1;
  tree.iterate({
    enter(node) {
      if (diagnostics.length >= 50) return false;
      if (node.type.isError) {
        const from = Math.max(0, Math.min(node.from, docText.length));
        const to = Math.max(from, Math.min(Math.max(node.to, from + 1), docText.length));
        if (from > lastEnd) {
          diagnostics.push({
            from,
            to,
            severity: "error",
            message: `Syntax error in ${lang.toUpperCase()}`,
          });
          lastEnd = to;
        }
      }
      return undefined;
    },
  });

  return diagnostics.slice(0, 50);
}

const embeddedMarkdownCodeLanguages = [
  LanguageDescription.of({
    name: "html",
    alias: ["htm", "xhtml"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "css",
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: "javascript",
    alias: ["js"],
    load: async () => javascript(),
  }),
  LanguageDescription.of({
    name: "typescript",
    alias: ["ts"],
    load: async () => javascript({ typescript: true }),
  }),
  LanguageDescription.of({
    name: "jsx",
    load: async () => javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: "tsx",
    load: async () => javascript({ jsx: true, typescript: true }),
  }),
];

function buildLanguageExtension(lang: EditorLanguage) {
  switch (lang) {
    case "html":
      return html();
    case "css":
      return css();
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "jsx":
      return javascript({ jsx: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "plain_text":
      return [];
    case "markdown":
    default:
      return markdown({ codeLanguages: embeddedMarkdownCodeLanguages });
  }
}

export interface MarkdownCodeEditorHandle {
  jumpToRange: (from: number, to: number, focus?: boolean) => void;
  setSearchHighlights: (ranges: SourceRange[], activeIndex: number | null) => void;
  getScrollRatio: () => number;
  setScrollRatio: (ratio: number) => void;
}

interface MarkdownCodeEditorProps {
  value: string;
  language?: EditorLanguage;
  onChange: (value: string) => void;
  onSave?: () => void;
  onOpenFind?: () => void;
  onScrollRatioChange?: (ratio: number) => void;
  onDiagnosticsChange?: (count: number) => void;
  placeholder?: string;
}

const setSearchDecoEffect = StateEffect.define<{
  ranges: SourceRange[];
  activeIndex: number | null;
}>();

const searchMatchMark = Decoration.mark({ class: "cm-knit-search-match" });
const searchActiveMark = Decoration.mark({ class: "cm-knit-search-match-active" });

const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const eff of tr.effects) {
      if (eff.is(setSearchDecoEffect)) {
        const docLen = tr.state.doc.length;
        const marks = eff.value.ranges
          .filter((r) => r.from >= 0 && r.to > r.from && r.to <= docLen)
          .map((r, idx) =>
            (eff.value.activeIndex === idx ? searchActiveMark : searchMatchMark).range(r.from, r.to),
          );
        return Decoration.set(marks, true);
      }
    }
    if (tr.docChanged) {
      return deco.map(tr.changes);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const vsCodeLightHighlight = HighlightStyle.define([
  { tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3], color: "#0451A5", fontWeight: "700" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "#0070C1", fontWeight: "600" },
  { tag: tags.strong, color: "#000080", fontWeight: "700" },
  { tag: tags.emphasis, color: "#0451A5", fontStyle: "italic" },
  { tag: tags.strikethrough, color: "#6C757D", textDecoration: "line-through" },
  { tag: [tags.link, tags.url], color: "#006AB1", textDecoration: "underline" },
  { tag: tags.quote, color: "#008000", fontStyle: "italic" },
  { tag: [tags.monospace, tags.processingInstruction], color: "#A31515" },
  { tag: [tags.list, tags.punctuation, tags.meta, tags.contentSeparator], color: "#0451A5" },
  { tag: [tags.comment], color: "#008000" },
  { tag: [tags.string], color: "#A31515" },
  { tag: [tags.keyword, tags.operator], color: "#AF00DB" },
  { tag: [tags.propertyName, tags.attributeName], color: "#0070C1" },
  { tag: [tags.number, tags.bool], color: "#098658" },
  { tag: [tags.tagName, tags.typeName], color: "#800000" },
  { tag: [tags.variableName, tags.function(tags.variableName)], color: "#001080" },
]);

const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#FFFFFF",
    color: "#212529",
    fontSize: "0.875rem",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--knit-font-mono)",
    lineHeight: "1.6",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "#007BFF",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "#F8F9FA",
    color: "#868E96",
    borderRight: "1px solid #DEE2E6",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 10px 0 8px",
    minWidth: "2.75rem",
    textAlign: "right",
    fontSize: "0.75rem",
  },
  ".cm-activeLine": {
    backgroundColor: "#F3F8FD",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#E9ECEF",
    color: "#212529",
    fontWeight: "600",
  },
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "#CFE2FF !important",
  },
  ".cm-knit-search-match": {
    backgroundColor: "#FFF3CD",
    borderRadius: "2px",
  },
  ".cm-knit-search-match-active": {
    backgroundColor: "#FFC107",
    outline: "1px solid #D97706",
    borderRadius: "2px",
  },
  ".cm-lintRange-error": {
    textDecoration: "underline wavy #DC3545",
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid #DC3545",
    backgroundColor: "#FFFFFF",
    color: "#212529",
    padding: "4px 8px",
    fontSize: "0.75rem",
  },
});

export const MarkdownCodeEditor = React.forwardRef<
  MarkdownCodeEditorHandle,
  MarkdownCodeEditorProps
>(
  (
    {
      value,
      language = "markdown",
      onChange,
      onSave,
      onOpenFind,
      onScrollRatioChange,
      onDiagnosticsChange,
      placeholder = "",
    },
    ref,
  ) => {
    const hostRef = React.useRef<HTMLDivElement | null>(null);
    const viewRef = React.useRef<EditorView | null>(null);
    const langCompartmentRef = React.useRef(new Compartment());
    const languageRef = React.useRef<EditorLanguage>(language);
    const onChangeRef = React.useRef(onChange);
    const onSaveRef = React.useRef(onSave);
    const onOpenFindRef = React.useRef(onOpenFind);
    const onScrollRatioRef = React.useRef(onScrollRatioChange);
    const onDiagnosticsChangeRef = React.useRef(onDiagnosticsChange);

    React.useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    React.useEffect(() => {
      onSaveRef.current = onSave;
    }, [onSave]);

    React.useEffect(() => {
      onOpenFindRef.current = onOpenFind;
    }, [onOpenFind]);

    React.useEffect(() => {
      onScrollRatioRef.current = onScrollRatioChange;
    }, [onScrollRatioChange]);

    React.useEffect(() => {
      onDiagnosticsChangeRef.current = onDiagnosticsChange;
    }, [onDiagnosticsChange]);

    React.useImperativeHandle(
      ref,
      () => ({
        jumpToRange: (from: number, to: number, focus = true) => {
          const view = viewRef.current;
          if (!view) return;
          const max = view.state.doc.length;
          const safeFrom = Math.max(0, Math.min(from, max));
          const safeTo = Math.max(safeFrom, Math.min(to, max));
          view.dispatch({
            selection: { anchor: safeFrom, head: safeTo },
            effects: EditorView.scrollIntoView(safeFrom, { y: "center" }),
          });
          if (focus) {
            view.focus();
          }
        },
        setSearchHighlights: (ranges: SourceRange[], activeIndex: number | null) => {
          const view = viewRef.current;
          if (!view) return;
          const effects: StateEffect<unknown>[] = [
            setSearchDecoEffect.of({ ranges, activeIndex }),
          ];
          if (activeIndex !== null && ranges[activeIndex]) {
            const target = ranges[activeIndex];
            effects.push(EditorView.scrollIntoView(target.from, { y: "center" }));
          }
          view.dispatch({ effects });
        },
        getScrollRatio: () => {
          const scroller = viewRef.current?.scrollDOM;
          if (!scroller) return 0;
          const maxScroll = scroller.scrollHeight - scroller.clientHeight;
          return maxScroll > 0 ? scroller.scrollTop / maxScroll : 0;
        },
        setScrollRatio: (ratio: number) => {
          const scroller = viewRef.current?.scrollDOM;
          if (!scroller) return;
          const maxScroll = scroller.scrollHeight - scroller.clientHeight;
          if (maxScroll > 0) {
            scroller.scrollTop = Math.min(1, Math.max(0, ratio)) * maxScroll;
          }
        },
      }),
      [],
    );

    React.useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const customKeymap = keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            onOpenFindRef.current?.();
            return true;
          },
        },
      ]);

      const syntaxLinter = linter(
        (view) => {
          const diags = collectSyntaxDiagnostics(
            view.state.doc.toString(),
            languageRef.current,
            view.state,
          );
          onDiagnosticsChangeRef.current?.(diags.length);
          return diags;
        },
        { delay: 250 },
      );

      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          lintGutter(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          langCompartmentRef.current.of(buildLanguageExtension(languageRef.current)),
          syntaxHighlighting(vsCodeLightHighlight),
          syntaxLinter,
          searchHighlightField,
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          customKeymap,
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          editorBaseTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });

      const view = new EditorView({ state, parent: host });
      viewRef.current = view;

      const handleScroll = () => {
        const scroller = view.scrollDOM;
        const maxScroll = scroller.scrollHeight - scroller.clientHeight;
        onScrollRatioRef.current?.(maxScroll > 0 ? scroller.scrollTop / maxScroll : 0);
      };
      view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        view.scrollDOM.removeEventListener("scroll", handleScroll);
        view.destroy();
        viewRef.current = null;
      };
      // Only create once on mount; external doc & language changes sync below
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
      languageRef.current = language;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: langCompartmentRef.current.reconfigure(buildLanguageExtension(language)),
      });
      forceLinting(view);
      const diags = collectSyntaxDiagnostics(view.state.doc.toString(), language, view.state);
      onDiagnosticsChangeRef.current?.(diags.length);
    }, [language]);

    React.useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (value !== current) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
      }
    }, [value]);

    return (
      <div
        ref={hostRef}
        data-editor-language={language}
        aria-label="Document code editor"
        className="h-full min-h-0 w-full flex-1 overflow-hidden bg-white"
      />
    );
  },
);

MarkdownCodeEditor.displayName = "MarkdownCodeEditor";
