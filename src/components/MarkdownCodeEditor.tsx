import React from "react";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
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
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { SourceRange } from "../lib/markdownSearch";

export interface MarkdownCodeEditorHandle {
  jumpToRange: (from: number, to: number, focus?: boolean) => void;
  setSearchHighlights: (ranges: SourceRange[], activeIndex: number | null) => void;
  getScrollRatio: () => number;
  setScrollRatio: (ratio: number) => void;
}

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  onOpenFind?: () => void;
  onScrollRatioChange?: (ratio: number) => void;
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
  { tag: [tags.monospace, tags.processingInstruction], color: "#A31515", backgroundColor: "#F3F3F3", borderRadius: "2px" },
  { tag: [tags.list, tags.punctuation, tags.meta, tags.contentSeparator], color: "#0451A5" },
  { tag: [tags.comment], color: "#008000" },
  { tag: [tags.string], color: "#A31515" },
  { tag: [tags.keyword, tags.operator], color: "#AF00DB" },
  { tag: [tags.propertyName, tags.attributeName], color: "#0070C1" },
  { tag: [tags.number, tags.bool], color: "#098658" },
]);

const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#FFFFFF",
    color: "#212529",
    fontSize: "12.5px",
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
    fontSize: "11.5px",
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
});

export const MarkdownCodeEditor = React.forwardRef<
  MarkdownCodeEditorHandle,
  MarkdownCodeEditorProps
>(({ value, onChange, onSave, onOpenFind, onScrollRatioChange, placeholder = "" }, ref) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onSaveRef = React.useRef(onSave);
  const onOpenFindRef = React.useRef(onOpenFind);
  const onScrollRatioRef = React.useRef(onScrollRatioChange);

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

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        markdown(),
        syntaxHighlighting(vsCodeLightHighlight),
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
    // Only create once on mount; external doc changes sync in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      aria-label="Markdown code editor"
      className="h-full min-h-0 w-full flex-1 overflow-hidden bg-white"
    />
  );
});

MarkdownCodeEditor.displayName = "MarkdownCodeEditor";
