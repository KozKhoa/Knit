import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileCode2,
  FileOutput,
  RefreshCw,
  Save,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { useI18n } from "../i18n";
import {
  convertDocContentToPdf,
  convertDocToPdf,
  formatBytes,
  getDocsEngineStatus,
  isTauriRuntime,
  pickFiles,
  pickSaveFile,
  previewDocMarkdown,
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
const THEMES: DocTheme[] = ["github", "academic", "minimal", "modern", "resume"];
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
  const [titleOverride, setTitleOverride] = usePersistentState<string>("knit.docs.titleOverride", "");
  const [includeToc, setIncludeToc] = usePersistentState<boolean>("knit.docs.includeToc", false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [previewPages, setPreviewPages] = React.useState<string[]>([]);
  const [previewTotalPages, setPreviewTotalPages] = React.useState<number>(0);

  const previewSeqRef = React.useRef(0);
  const lastHandledDropSeq = React.useRef<number>(0);

  const docKind = detectDocKind(inputPath);
  const isEditableText =
    docKind === "markdown" || docKind === "plain_text" || docKind === "html";
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
      setPreviewPages([]);
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

  const runLivePreview = React.useCallback(async () => {
    if (!isTauriRuntime() || !isEditableText) return;
    if (editorText.trim().length === 0) {
      setPreviewPages([]);
      setPreviewTotalPages(0);
      setPreviewError(null);
      return;
    }

    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await previewDocMarkdown(
        editorText,
        docKind,
        parentDirOf(inputPath),
        docOptions,
        20,
        880,
      );
      if (previewSeqRef.current !== seq) return;
      setPreviewPages(res.pages_png_base64.map((b64) => `data:image/png;base64,${b64}`));
      setPreviewTotalPages(res.page_count);
    } catch (e) {
      if (previewSeqRef.current !== seq) return;
      setPreviewError(String(e));
    } finally {
      if (previewSeqRef.current === seq) {
        setPreviewLoading(false);
      }
    }
  }, [docKind, docOptions, editorText, inputPath, isEditableText]);

  React.useEffect(() => {
    if (!isTauriRuntime() || !isEditableText) return;
    if (editorText.trim().length === 0) {
      setPreviewPages([]);
      setPreviewTotalPages(0);
      setPreviewError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runLivePreview();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [editorText, docOptions, docKind, inputPath, isEditableText, runLivePreview]);

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

      const res =
        isEditableText && editorText.trim().length > 0
          ? await convertDocContentToPdf(
              jobId,
              editorText,
              docKind,
              parentDirOf(inputPath),
              inputPath,
              outPath,
              docOptions,
              onJobEvent,
            )
          : await convertDocToPdf(jobId, inputPath!, outPath, docOptions, onJobEvent);

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
      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.themeLabel}
          </label>
          <select
            aria-label={t.docs2pdf.themeLabel}
            value={theme}
            onChange={(e) => setTheme(e.target.value as DocTheme)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
          >
            {THEMES.map((th) => (
              <option key={th} value={th}>
                {t.docs2pdf.themes[th]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.pdfFontLabel}
          </label>
          <select
            aria-label={t.docs2pdf.pdfFontLabel}
            value={pdfFont}
            onChange={(e) => setPdfFont(e.target.value as DocFont)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
          >
            {PDF_FONTS.map((f) => (
              <option key={f} value={f}>
                {t.docs2pdf.fonts[f]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.paperSizeLabel}
          </label>
          <select
            aria-label={t.docs2pdf.paperSizeLabel}
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value as PageSizePreset)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
          >
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="a5">A5</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.marginMmLabel}
          </label>
          <input
            type="number"
            min={5}
            max={50}
            value={marginMm}
            onChange={(e) => setMarginMm(Number(e.target.value) || 20)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.fontSizeLabel}
          </label>
          <input
            type="number"
            min={8}
            max={20}
            value={fontSizePt}
            onChange={(e) => setFontSizePt(Number(e.target.value) || 11)}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
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
      {isEditableText ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Left: Live Markdown Editor */}
          <div className="flex flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
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

            <textarea
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void handleSaveText(false);
                }
              }}
              placeholder={t.docs2pdf.newDocPlaceholder}
              spellCheck={false}
              className="min-h-[540px] w-full flex-1 resize-y border-0 bg-white p-3.5 font-mono-code text-xs leading-relaxed text-[#212529] focus:outline-none"
            />
          </div>

          {/* Right: Live PDF Preview */}
          <div className="flex flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
              <div className="flex items-center gap-2 text-sm font-bold text-[#343A40]">
                <Eye className="h-4 w-4 text-[#007BFF]" />
                <span>{t.docs2pdf.previewTitle}</span>
                {previewTotalPages > 0 && (
                  <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                    {t.docs2pdf.previewPageCount(previewPages.length, previewTotalPages)}
                  </span>
                )}
              </div>
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

            {previewError && (
              <div className="border-b border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2 text-xs text-[#721C24]">
                {previewError}
              </div>
            )}

            <div className="max-h-[600px] min-h-[540px] flex-1 space-y-4 overflow-y-auto bg-[#E9ECEF] p-4">
              {previewLoading && previewPages.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#6C757D]">
                  {t.docs2pdf.previewRendering}
                </div>
              ) : previewPages.length === 0 ? (
                <div className="py-12 text-center text-sm text-[#6C757D]">
                  {t.docs2pdf.previewEmpty}
                </div>
              ) : (
                previewPages.map((src, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="font-mono-code text-[11px] font-semibold text-[#6C757D]">
                      #{idx + 1} / {previewTotalPages}
                    </div>
                    <img
                      src={src}
                      alt={`Preview page ${idx + 1}`}
                      className="w-full rounded-[2px] border border-[#CED4DA] bg-white"
                    />
                  </div>
                ))
              )}
            </div>
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
