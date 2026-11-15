import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface JsonCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  height?: string;
}

interface JsonStreamState {
  expectKeyOrClose: boolean;
}

const jsonStreamLanguage = StreamLanguage.define<JsonStreamState>({
  startState: () => ({ expectKeyOrClose: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;

    const ch = stream.peek();
    if (!ch) return null;

    if (ch === "{") {
      stream.next();
      state.expectKeyOrClose = true;
      return "brace";
    }
    if (ch === "}" || ch === "]") {
      stream.next();
      state.expectKeyOrClose = false;
      return "brace";
    }
    if (ch === "[") {
      stream.next();
      state.expectKeyOrClose = false;
      return "bracket";
    }
    if (ch === ",") {
      stream.next();
      // Remain flexible inside objects; lookahead handles key styling cleanly
      return "punctuation";
    }
    if (ch === ":") {
      stream.next();
      state.expectKeyOrClose = false;
      return "punctuation";
    }

    if (ch === '"') {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const c = stream.next();
        if (escaped) {
          escaped = false;
        } else if (c === "\\") {
          escaped = true;
        } else if (c === '"') {
          break;
        }
      }
      // Distinguish object keys ("key":) from string values
      const isKey = /^\s*:/.test(stream.string.slice(stream.pos));
      return isKey ? "propertyName" : "string";
    }

    if (
      stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    ) {
      return "number";
    }

    if (stream.match(/^(?:true|false)\b/)) {
      return "bool";
    }

    if (stream.match(/^null\b/)) {
      return "null";
    }

    stream.next();
    return "invalid";
  },
});

const jsonLightHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "#0451a5", fontWeight: "600" },
  { tag: tags.string, color: "#a31515" },
  { tag: tags.number, color: "#098658" },
  { tag: tags.bool, color: "#0000ff", fontWeight: "600" },
  { tag: tags.null, color: "#795e26", fontWeight: "600" },
  { tag: [tags.brace, tags.bracket, tags.punctuation], color: "#495057" },
  { tag: tags.invalid, color: "#dc3545", textDecoration: "underline" },
]);

const jsonEditorTheme = EditorView.theme(
  {
    "&": {
      color: "#212529",
      backgroundColor: "#F8F9FA",
      colorScheme: "light",
      fontSize: "12.5px",
    },
    ".cm-scroller": {
      overflow: "auto",
      colorScheme: "light",
      scrollbarWidth: "thin",
      scrollbarColor: "#ced4da #f1f3f5",
      fontFamily:
        "var(--knit-font-mono, 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace)",
      lineHeight: "1.6",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "8px",
      height: "8px",
      backgroundColor: "#F1F3F5",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      backgroundColor: "#F1F3F5",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      backgroundColor: "#CED4DA",
      borderRadius: "4px",
      border: "1px solid #F1F3F5",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      backgroundColor: "#ADB5BD",
    },
    ".cm-content": {
      padding: "10px 0",
      caretColor: "#007BFF",
    },
    ".cm-line": {
      padding: "0 12px",
    },
    ".cm-gutters": {
      backgroundColor: "#F1F3F5",
      color: "#868E96",
      borderRight: "1px solid #DEE2E6",
      minWidth: "40px",
    },
    ".cm-activeLine": {
      backgroundColor: "#E7F1FF80",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#E9ECEF",
      color: "#212529",
    },
    "&.cm-focused": {
      outline: "none",
      backgroundColor: "#FFFFFF",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "#CCE5FF",
    },
    ".cm-cursor": {
      borderLeftColor: "#007BFF",
      borderLeftWidth: "2px",
    },
  },
  { dark: false },
);

/** Syntax-highlighted CodeMirror 6 JSON editor locked to the app light theme. */
export function JsonCodeEditor({
  value,
  onChange,
  height = "360px",
}: JsonCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        jsonStreamLanguage,
        syntaxHighlighting(jsonLightHighlight),
        jsonEditorTheme,
        EditorView.theme({
          "&": { height },
        }),
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
  }, [height]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div
      ref={hostRef}
      style={{ colorScheme: "light" }}
      className="w-full overflow-hidden rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] focus-within:border-[#007BFF]"
    />
  );
}
