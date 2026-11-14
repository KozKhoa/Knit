import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileCode2,
  FileOutput,
  GripHorizontal,
  Loader2,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import {
  MarkdownCodeEditor,
  type MarkdownCodeEditorHandle,
} from "../components/MarkdownCodeEditor";
import { NumberInput } from "../components/NumberInput";
import { PdfJsPreview, type PdfJsPreviewHandle } from "../components/PdfJsPreview";
import { Select } from "../components/Select";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import { findAllTextMatches, findMarkdownSourceRange } from "../lib/markdownSearch";
import { MERMAID_THEMES, type MermaidTheme, renderMermaidSvgs } from "../lib/mermaid";
import {
  convertDocContentToPdf,
  convertDocToPdf,
  formatBytes,
  getDocsEngineStatus,
  isTauriRuntime,
  pickFiles,
  pickSaveFile,
  previewDocPdfBytes,
  readDocTextFile,
  writeDocTextFile,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
  DocConvertOptions,
  DocFont,
  DocInputKind,
  DocTheme,
  EngineStatus,
  JobEvent,
  PageSizePreset,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

interface Docs2PdfViewProps {
  onStartJob: (jobId: string, label: string) => void;
  onJobEvent: (ev: JobEvent) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
  ) => void;
  busy: boolean;
  droppedBatch?: DroppedBatch | null;
}

const SUPPORTED_DOC_RE = /\.(md|markdown|txt|html|htm|epub|docx|pptx)$/i;
const THEMES: DocTheme[] = [
  "github",
  "vs_code_light",
  "obsidian",
  "academic",
  "minimal",
  "modern",
  "resume",
];
const PDF_FONTS: DocFont[] = [
  "default",
  "afacad",
  "roboto",
  "lora",
  "libertinus_serif",
  "new_computer_modern",
  "dejavu_sans_mono",
];

function detectDocKind(path: string | null): DocInputKind {
  if (!path) return "markdown";
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".log") || lower.endsWith(".rst")) return "plain_text";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pptx")) return "pptx";
  return "markdown";
}

function parentDirOf(path: string | null): string | null {
  if (!path) return null;
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

export const Docs2PdfView: React.FC<Docs2PdfViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [inputPath, setInputPath] = React.useState<string | null>(null);
  const [editorText, setEditorText] = React.useState<string>("");
  const [savedText, setSavedText] = React.useState<string>("");
  const [saveFeedback, setSaveFeedback] = React.useState<string | null>(null);

  const [engineStatus, setEngineStatus] = React.useState<EngineStatus | null>(null);
  const [pageSize, setPageSize] = usePersistentState<PageSizePreset>("knit.docs.pageSize", "a4");
  const [marginMm, setMarginMm] = usePersistentState<number>("knit.docs.marginMm", 20);
  const [fontSizePt, setFontSizePt] = usePersistentState<number>("knit.docs.fontSizePt", 11);
  const [theme, setTheme] = usePersistentState<DocTheme>("knit.docs.theme", "github");
  const [pdfFont, setPdfFont] = usePersistentState<DocFont>("knit.docs.font", "default");
  const [mermaidTheme, setMermaidTheme] = usePersistentState<MermaidTheme>(
    "knit.docs.mermaidTheme",
    "default",
  );
  const [titleOverride, setTitleOverride] = usePersistentState<string>("knit.docs.titleOverride", "");
  const [includeToc, setIncludeToc] = usePersistentState<boolean>("knit.docs.includeToc", false);
  const [workspaceHeightPx, setWorkspaceHeightPx] = usePersistentState<number>(
    "knit.docs.workspaceHeightPx",
    560,
  );
  const { height: liveHeightPx, handlePointerDown: handleStartHeightResize } = useVerticalResize({
    value: workspaceHeightPx,
    min: 320,
    max: 1200,
    onCommit: setWorkspaceHeightPx,
  });
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewPdfBytes, setPreviewPdfBytes] = React.useState<Uint8Array | null>(null);
  const [previewTotalPages, setPreviewTotalPages] = React.useState<number>(0);

  // Independent Find state for Editor vs Preview
  const [editorFindOpen, setEditorFindOpen] = React.useState(false);
  const [editorFindQuery, setEditorFindQuery] = React.useState("");
  const [editorFindIdx, setEditorFindIdx] = React.useState(0);

  const [previewFindOpen, setPreviewFindOpen] = React.useState(false);
  const [previewFindQuery, setPreviewFindQuery] = React.useState("");
  const [previewFindIdx, setPreviewFindIdx] = React.useState(0);
  const [previewMatchCount, setPreviewMatchCount] = React.useState(0);

  const [syncScroll, setSyncScroll] = usePersistentState<boolean>("knit.docs.syncScroll", false);

  const previewSeqRef = React.useRef(0);
  const lastHandledDropSeq = React.useRef<number>(0);
  const mermaidCacheRef = React.useRef<Map<string, string>>(new Map());
  const editorRef = React.useRef<MarkdownCodeEditorHandle | null>(null);
  const previewRef = React.useRef<PdfJsPreviewHandle | null>(null);
  const editorFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const previewFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const editorPaneRef = React.useRef<HTMLDivElement | null>(null);
  const previewPaneRef = React.useRef<HTMLDivElement | null>(null);
  const syncLockRef = React.useRef<{ source: "editor" | "preview" | null; until: number }>({
    source: null,
    until: 0,
  });

  const docKind = detectDocKind(inputPath);
  const isEditableText =
    docKind === "markdown" || docKind === "plain_text" || docKind === "html";
  const isPreviewableDoc = isEditableText || (docKind === "epub" && Boolean(inputPath));
  const isOfficeFile = docKind === "docx" || docKind === "pptx";
  const isDirty = isEditableText && editorText !== savedText;

  const docOptions = React.useMemo<DocConvertOptions>(
    () => ({
      page_size: pageSize,
      margin_mm: marginMm,
      font_size_pt: fontSizePt,
      title: titleOverride.trim() !== "" ? titleOverride.trim() : null,
      include_toc: includeToc,
      theme,
      font: pdfFont,
    }),
    [pageSize, marginMm, fontSizePt, titleOverride, includeToc, theme, pdfFont],
  );

  const checkEngine = React.useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      const status = await getDocsEngineStatus();
      setEngineStatus(status);
    } catch {
      // ignore outside Tauri
    }
  }, []);

  React.useEffect(() => {
    void checkEngine();
  }, [checkEngine]);

  const loadDocumentPath = React.useCallback(async (path: string) => {
    setErrorMsg(null);
    setSaveFeedback(null);
    setInputPath(path);
    const kind = detectDocKind(path);
    if (kind === "markdown" || kind === "plain_text" || kind === "html") {
      if (isTauriRuntime()) {
        try {
          const text = await readDocTextFile(path);
          setEditorText(text);
          setSavedText(text);
        } catch (e) {
          setErrorMsg(String(e));
        }
      }
    } else {
      setEditorText("");
      setSavedText("");
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
    }
  }, []);

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    const match = droppedBatch.paths.find((p) => SUPPORTED_DOC_RE.test(p));
    if (match) {
      void loadDocumentPath(match);
    }
  }, [droppedBatch, loadDocumentPath]);

  const openEditorFind = React.useCallback(() => {
    setEditorFindOpen(true);
    window.requestAnimationFrame(() => {
      editorFindInputRef.current?.focus();
      editorFindInputRef.current?.select();
    });
  }, []);

  const openPreviewFind = React.useCallback(() => {
    setPreviewFindOpen(true);
    window.requestAnimationFrame(() => {
      previewFindInputRef.current?.focus();
      previewFindInputRef.current?.select();
    });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const active = document.activeElement;
        if (active && previewPaneRef.current?.contains(active)) {
          openPreviewFind();
        } else {
          openEditorFind();
        }
      } else if (e.key === "Escape") {
        if (editorFindOpen) {
          setEditorFindOpen(false);
          setEditorFindQuery("");
        }
        if (previewFindOpen) {
          setPreviewFindOpen(false);
          setPreviewFindQuery("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorFindOpen, previewFindOpen, openEditorFind, openPreviewFind]);

  const editorMatches = React.useMemo(
    () => (isEditableText && editorFindOpen ? findAllTextMatches(editorText, editorFindQuery) : []),
    [editorText, editorFindOpen, editorFindQuery, isEditableText],
  );
  const activeEditorMatchIdx =
    editorFindOpen && editorFindQuery.trim() && editorMatches.length > 0
      ? ((editorFindIdx % editorMatches.length) + editorMatches.length) % editorMatches.length
      : null;

  const activePreviewMatchIdx =
    previewFindOpen && previewFindQuery.trim() && previewMatchCount > 0
      ? ((previewFindIdx % previewMatchCount) + previewMatchCount) % previewMatchCount
      : null;

  React.useEffect(() => {
    if (!editorFindOpen || !editorFindQuery.trim()) {
      editorRef.current?.setSearchHighlights([], null);
      return;
    }
    editorRef.current?.setSearchHighlights(editorMatches, activeEditorMatchIdx);
  }, [editorFindOpen, editorFindQuery, editorMatches, activeEditorMatchIdx]);

  React.useEffect(() => {
    if (activePreviewMatchIdx !== null) {
      previewRef.current?.scrollToMatch(activePreviewMatchIdx);
    }
  }, [activePreviewMatchIdx]);

  const handleToggleSyncScroll = (checked: boolean) => {
    setSyncScroll(checked);
    if (checked) {
      const ratio = editorRef.current?.getScrollRatio() ?? 0;
      syncLockRef.current = { source: "editor", until: performance.now() + 140 };
      previewRef.current?.setScrollRatio(ratio);
    }
  };

  const handleEditorScrollRatio = React.useCallback(
    (ratio: number) => {
      if (!syncScroll) return;
      const now = performance.now();
      if (syncLockRef.current.source === "preview" && now < syncLockRef.current.until) return;
      syncLockRef.current = { source: "editor", until: now + 100 };
      previewRef.current?.setScrollRatio(ratio);
    },
    [syncScroll],
  );

  const handlePreviewScrollRatio = React.useCallback(
    (ratio: number) => {
      if (!syncScroll) return;
      const now = performance.now();
      if (syncLockRef.current.source === "editor" && now < syncLockRef.current.until) return;
      syncLockRef.current = { source: "preview", until: now + 100 };
      editorRef.current?.setScrollRatio(ratio);
    },
    [syncScroll],
  );

  const handleGoToInEditor = React.useCallback(
    (selectedText: string, occurrenceIndex = 0) => {
      if (!isEditableText) return;
      const range = findMarkdownSourceRange(editorText, selectedText, occurrenceIndex);
      if (range) {
        setErrorMsg(null);
        editorRef.current?.jumpToRange(range.from, range.to, true);
      } else {
        setErrorMsg(t.docs2pdf.gotoNotFound);
      }
    },
    [editorText, isEditableText, t.docs2pdf.gotoNotFound],
  );

  const runLivePreview = React.useCallback(async () => {
    if (!isTauriRuntime() || !isPreviewableDoc) return;
    if (isEditableText && editorText.trim().length === 0) {
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
      setPreviewError(null);
      return;
    }

    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const mermaidSvgs =
        docKind === "markdown"
          ? await renderMermaidSvgs(editorText, mermaidTheme, mermaidCacheRef.current)
          : {};
      if (previewSeqRef.current !== seq) return;
      const pdfBytes = await previewDocPdfBytes({
        content: isEditableText ? editorText : null,
        inputPath: docKind === "epub" ? inputPath : null,
        inputKind: docKind,
        baseDir: parentDirOf(inputPath),
        options: {
          ...docOptions,
          mermaid_svgs: mermaidSvgs,
        },
      });
      if (previewSeqRef.current !== seq) return;
      setPreviewPdfBytes(pdfBytes);
    } catch (e) {
      if (previewSeqRef.current !== seq) return;
      setPreviewError(String(e));
    } finally {
      if (previewSeqRef.current === seq) {
        setPreviewLoading(false);
      }
    }
  }, [docKind, docOptions, editorText, inputPath, isEditableText, isPreviewableDoc, mermaidTheme]);

  React.useEffect(() => {
    if (!isTauriRuntime() || !isPreviewableDoc) return;
    if (isEditableText && editorText.trim().length === 0) {
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
      setPreviewError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runLivePreview();
    }, docKind === "epub" ? 150 : 600);
    return () => window.clearTimeout(timer);
  }, [
    editorText,
    docOptions,
    docKind,
    inputPath,
    isEditableText,
    isPreviewableDoc,
    mermaidTheme,
    runLivePreview,
  ]);

  const handlePickDoc = async () => {
    setErrorMsg(null);
    try {
      const files = await pickFiles({
        title: t.docs2pdf.pickDocDialog,
        multiple: false,
        filters: [
          {
            name: "Documents",
            extensions: ["md", "markdown", "txt", "html", "htm", "epub", "docx", "pptx"],
          },
        ],
      });
      if (files.length > 0) {
        await loadDocumentPath(files[0]);
      }
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleSaveText = async (saveAs: boolean) => {
    setErrorMsg(null);
    setSaveFeedback(null);
    try {
      let targetPath = !saveAs && inputPath && isEditableText ? inputPath : null;
      if (!targetPath) {
        targetPath = await pickSaveFile({
          title: t.docs2pdf.saveMdDialog,
          defaultPath: inputPath || "document.md",
          filters: [
            { name: "Markdown", extensions: ["md", "markdown"] },
            { name: "Text / HTML", extensions: ["txt", "html"] },
          ],
        });
      }
      if (!targetPath) return;

      await writeDocTextFile(targetPath, editorText);
      setInputPath(targetPath);
      setSavedText(editorText);
      setSaveFeedback(t.docs2pdf.savedMdStatus);
      window.setTimeout(() => setSaveFeedback(null), 2500);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const canConvert = isEditableText
    ? editorText.trim().length > 0 || Boolean(inputPath)
    : Boolean(inputPath);

  const handleConvert = async () => {
    if (!canConvert || busy) return;
    setErrorMsg(null);
    try {
      const defaultOut = inputPath
        ? inputPath.replace(/\.[^.]+$/, "") + ".pdf"
        : "document.pdf";
      const outPath = await pickSaveFile({
        title: t.docs2pdf.savePdfDialog,
        defaultPath: defaultOut,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outPath) return;

      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.docs2pdf.label);

      const mermaidSvgs =
        docKind === "markdown" && editorText.trim().length > 0
          ? await renderMermaidSvgs(editorText, mermaidTheme, mermaidCacheRef.current)
          : {};
      const finalOptions: DocConvertOptions = {
        ...docOptions,
        mermaid_svgs: mermaidSvgs,
      };

      const res =
        isEditableText && editorText.trim().length > 0
          ? await convertDocContentToPdf(
              jobId,
              editorText,
              docKind,
              parentDirOf(inputPath),
              inputPath,
              outPath,
              finalOptions,
              onJobEvent,
            )
          : await convertDocToPdf(jobId, inputPath!, outPath, finalOptions, onJobEvent);

      onFinishJob(
        t.shell.nav.docs2pdf.label,
        [res.output_path],
        t.docs2pdf.doneSummary(
          String(res.page_count ?? "?"),
          formatBytes(res.bytes_written),
          res.used_external_engine ? "LibreOffice" : "Typst Native",
        ),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.shell.nav.docs2pdf.label, [], msg, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.docs2pdf.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.docs2pdf.subtitle}</p>
        </div>
        <button
          type="button"
          disabled={!canConvert || busy || (isOfficeFile && engineStatus?.libreoffice_available === false)}
          onClick={() => void handleConvert()}
          className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
        >
          <FileOutput className="h-4 w-4" />
          {t.docs2pdf.convertBtn}
        </button>
      </div>

      {engineStatus && (
        <div
          className={`flex items-center justify-between rounded-[4px] border px-3.5 py-2.5 text-sm ${
            engineStatus.libreoffice_available
              ? "border-[#C3E6CB] bg-[#D4EDDA] text-[#155724]"
              : "border-[#FFEEBA] bg-[#FFF3CD] text-[#856404]"
          }`}
        >
          <div className="flex items-center gap-2">
            {engineStatus.libreoffice_available ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>
              {engineStatus.libreoffice_available
                ? t.docs2pdf.libreReady(
                    engineStatus.version_text || engineStatus.executable_path || "soffice",
                  )
                : t.docs2pdf.libreMissing}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void checkEngine()}
            className="knit-control-sm flex shrink-0 items-center gap-1 rounded-[4px] border border-current px-2.5 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t.docs2pdf.rescanBtn}
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      <Dropzone
        title={t.docs2pdf.dropTitle}
        description={t.docs2pdf.dropDesc}
        onPickFiles={() => void handlePickDoc()}
        filesLabel={t.docs2pdf.pickDocBtn}
      />

      {inputPath && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <FileCode2 className="h-4 w-4 shrink-0 text-[#007BFF]" />
            <span className="font-semibold">{t.docs2pdf.selectedFileLabel}</span>
            <span className="font-mono-code truncate text-xs text-[#343A40]">{inputPath}</span>
          </div>
          {isDirty && (
            <span className="rounded-[4px] bg-[#FFF3CD] px-2 py-0.5 text-xs font-semibold text-[#856404]">
              {t.docs2pdf.unsavedBadge}
            </span>
          )}
        </div>
      )}

      {/* Formatting, Theme & Font Options Bar */}
      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.themeLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.themeLabel}
            value={theme}
            onChange={(val) => setTheme(val as DocTheme)}
            className="mt-1 w-full"
            options={THEMES.map((th) => ({ value: th, label: t.docs2pdf.themes[th] }))}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.pdfFontLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.pdfFontLabel}
            value={pdfFont}
            onChange={(val) => setPdfFont(val as DocFont)}
            className="mt-1 w-full"
            options={PDF_FONTS.map((f) => ({ value: f, label: t.docs2pdf.fonts[f] }))}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.mermaidThemeLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.mermaidThemeLabel}
            value={mermaidTheme}
            onChange={(val) => setMermaidTheme(val as MermaidTheme)}
            className="mt-1 w-full"
            options={MERMAID_THEMES.map((mt) => ({
              value: mt,
              label: t.docs2pdf.mermaidThemes[mt],
            }))}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.paperSizeLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.paperSizeLabel}
            value={pageSize}
            onChange={(val) => setPageSize(val as PageSizePreset)}
            className="mt-1 w-full"
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: "US Letter" },
              { value: "a5", label: "A5" },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.marginMmLabel}
          </label>
          <NumberInput
            ariaLabel={t.docs2pdf.marginMmLabel}
            min={5}
            max={50}
            value={marginMm}
            onChange={setMarginMm}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.fontSizeLabel}
          </label>
          <NumberInput
            ariaLabel={t.docs2pdf.fontSizeLabel}
            min={8}
            max={20}
            value={fontSizePt}
            onChange={setFontSizePt}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.titleAndTocLabel}
          </label>
          <input
            type="text"
            placeholder={t.docs2pdf.titlePlaceholder}
            value={titleOverride}
            onChange={(e) => setTitleOverride(e.target.value)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              checked={includeToc}
              onChange={(e) => setIncludeToc(e.target.checked)}
            />
            {t.docs2pdf.includeTocLabel}
          </label>
        </div>
      </div>

      {/* Split Workspace: Markdown Editor (Left) & Live PDF Preview (Right) */}
      {isPreviewableDoc ? (
        <div className="space-y-2">
          <div
            style={{ height: `${liveHeightPx}px` }}
            className={`grid min-h-[320px] grid-cols-1 gap-4 ${
              isEditableText ? "lg:grid-cols-2" : "lg:grid-cols-1"
            }`}
          >
            {/* Left: Live Markdown Editor */}
            {isEditableText && (
              <div
                ref={editorPaneRef}
                className="flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white"
              >
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
                  <div className="flex items-center gap-2 text-sm font-bold text-[#343A40]">
                    <FileCode2 className="h-4 w-4 text-[#007BFF]" />
                    <span>{t.docs2pdf.editorTitle}</span>
                    {saveFeedback && (
                      <span className="rounded-[4px] bg-[#D4EDDA] px-2 py-0.5 text-xs font-semibold text-[#155724]">
                        {saveFeedback}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={openEditorFind}
                      title="Ctrl+F"
                      className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      <Search className="h-3.5 w-3.5 text-[#007BFF]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveText(false)}
                      className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      <Save className="h-3.5 w-3.5 text-[#007BFF]" />
                      {t.docs2pdf.saveMdBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveText(true)}
                      className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      {t.docs2pdf.saveMdAsBtn}
                    </button>
                  </div>
                </div>

                {editorFindOpen && (
                  <div className="flex shrink-0 items-center gap-1.5 border-b border-[#B6D4FE] bg-[#F8FAFF] px-3 py-1.5 text-xs">
                    <Search className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
                    <input
                      ref={editorFindInputRef}
                      type="text"
                      value={editorFindQuery}
                      onChange={(e) => {
                        setEditorFindQuery(e.target.value);
                        setEditorFindIdx(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editorMatches.length > 0) {
                          e.preventDefault();
                          setEditorFindIdx((i) => i + (e.shiftKey ? -1 : 1));
                        } else if (e.key === "Escape") {
                          setEditorFindOpen(false);
                          setEditorFindQuery("");
                        }
                      }}
                      placeholder={t.docs2pdf.findEditorPlaceholder}
                      className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs text-[#212529]"
                    />
                    {editorFindQuery.trim() !== "" && (
                      <span className="font-mono-code text-[11px] font-semibold text-[#0056B3]">
                        {editorMatches.length > 0
                          ? `${(activeEditorMatchIdx ?? 0) + 1}/${editorMatches.length}`
                          : "0/0"}
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={editorMatches.length === 0}
                      onClick={() => setEditorFindIdx((i) => i - 1)}
                      title={t.docs2pdf.findPrevTitle}
                      className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={editorMatches.length === 0}
                      onClick={() => setEditorFindIdx((i) => i + 1)}
                      title={t.docs2pdf.findNextTitle}
                      className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditorFindOpen(false);
                        setEditorFindQuery("");
                      }}
                      aria-label={t.common.close}
                      className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#6C757D] hover:bg-[#E9ECEF]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <MarkdownCodeEditor
                  ref={editorRef}
                  value={editorText}
                  onChange={setEditorText}
                  onSave={() => void handleSaveText(false)}
                  onOpenFind={openEditorFind}
                  onScrollRatioChange={handleEditorScrollRatio}
                  placeholder={t.docs2pdf.newDocPlaceholder}
                />
              </div>
            )}

            {/* Right: Live PDF Preview via pdfjs-dist */}
            <div
              ref={previewPaneRef}
              className="flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white"
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
                <div className="flex items-center gap-2 text-sm font-bold text-[#343A40]">
                  {previewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#007BFF]" />
                  ) : (
                    <Eye className="h-4 w-4 text-[#007BFF]" />
                  )}
                  <span>{t.docs2pdf.previewTitle}</span>
                  {previewTotalPages > 0 && (
                    <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                      {previewTotalPages} p.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isEditableText && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#343A40]">
                      <input
                        type="checkbox"
                        checked={syncScroll}
                        onChange={(e) => handleToggleSyncScroll(e.target.checked)}
                      />
                      {t.docs2pdf.syncScrollLabel}
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={openPreviewFind}
                    title="Ctrl+F"
                    className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                  >
                    <Search className="h-3.5 w-3.5 text-[#007BFF]" />
                  </button>
                  <button
                    type="button"
                    disabled={previewLoading}
                    onClick={() => void runLivePreview()}
                    className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? "animate-spin" : ""}`} />
                    {t.docs2pdf.refreshPreviewBtn}
                  </button>
                </div>
              </div>

              {previewFindOpen && (
                <div className="flex shrink-0 items-center gap-1.5 border-b border-[#B6D4FE] bg-[#F8FAFF] px-3 py-1.5 text-xs">
                  <Search className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
                  <input
                    ref={previewFindInputRef}
                    type="text"
                    value={previewFindQuery}
                    onChange={(e) => {
                      setPreviewFindQuery(e.target.value);
                      setPreviewFindIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && previewMatchCount > 0) {
                        e.preventDefault();
                        setPreviewFindIdx((i) => i + (e.shiftKey ? -1 : 1));
                      } else if (e.key === "Escape") {
                        setPreviewFindOpen(false);
                        setPreviewFindQuery("");
                      }
                    }}
                    placeholder={t.docs2pdf.findPreviewPlaceholder}
                    className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs text-[#212529]"
                  />
                  {previewFindQuery.trim() !== "" && (
                    <span className="font-mono-code text-[11px] font-semibold text-[#856404]">
                      {previewMatchCount > 0
                        ? `${(activePreviewMatchIdx ?? 0) + 1}/${previewMatchCount}`
                        : "0/0"}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={previewMatchCount === 0}
                    onClick={() => setPreviewFindIdx((i) => i - 1)}
                    title={t.docs2pdf.findPrevTitle}
                    className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={previewMatchCount === 0}
                    onClick={() => setPreviewFindIdx((i) => i + 1)}
                    title={t.docs2pdf.findNextTitle}
                    className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewFindOpen(false);
                      setPreviewFindQuery("");
                    }}
                    aria-label={t.common.close}
                    className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#6C757D] hover:bg-[#E9ECEF]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="min-h-0 flex-1">
                <PdfJsPreview
                  ref={previewRef}
                  pdfBytes={previewPdfBytes}
                  loading={previewLoading}
                  error={previewError}
                  emptyText={t.docs2pdf.previewEmpty}
                  loadingText={t.docs2pdf.previewRendering}
                  onPageCountChange={setPreviewTotalPages}
                  searchQuery={previewFindOpen ? previewFindQuery : ""}
                  activeMatchIndex={activePreviewMatchIdx}
                  onSearchMatchCountChange={setPreviewMatchCount}
                  copyTextLabel={t.docs2pdf.copyText}
                  goToInEditorLabel={t.docs2pdf.gotoInEditor}
                  onGoToInEditor={isEditableText ? handleGoToInEditor : undefined}
                  onScrollRatioChange={handlePreviewScrollRatio}
                  onOpenFind={openPreviewFind}
                />
              </div>
            </div>
          </div>

          {/* Bottom Vertical Resize Handle */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and preview height"
            onPointerDown={handleStartHeightResize}
            className="mt-1.5 flex h-5 cursor-ns-resize select-none items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] text-[#6C757D] transition-colors hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]"
            title={`${liveHeightPx}px`}
          >
            <GripHorizontal className="h-4 w-4" />
            <span className="ml-2 font-mono-code text-[11px]">{liveHeightPx}px</span>
          </div>
        </div>
      ) : (
        <div className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 text-sm text-[#6C757D]">
          {t.docs2pdf.editorReadonlyNotice}
        </div>
      )}
    </div>
  );
};
