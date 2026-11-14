import React from "react";
import { EditorState } from "@codemirror/state";
import {
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

interface MarkdownCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  placeholder?: string;
}

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
});

export const MarkdownCodeEditor: React.FC<MarkdownCodeEditorProps> = ({
  value,
  onChange,
  onSave,
  placeholder = "",
}) => {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const onChangeRef = React.useRef(onChange);
  const onSaveRef = React.useRef(onSave);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSaveRef.current?.();
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
        EditorView.lineWrapping,
        cmPlaceholder(placeholder),
        saveKeymap,
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

    return () => {
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
};
