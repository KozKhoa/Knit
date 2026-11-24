import React from "react";
import { AlertTriangle, Eye, FileCode2, Loader2, RefreshCw, Save, Search } from "lucide-react";
import { DocumentFindBar } from "../../components/DocumentFindBar";
import {
  EDITOR_LANGUAGE_OPTIONS,
  editorLanguageExtension,
  MarkdownCodeEditor,
  type EditorLanguage,
  type EditorSyntaxSummary,
  type MarkdownCodeEditorHandle,
} from "../../components/MarkdownCodeEditor";
import { PaneResizeHandle } from "../../components/PaneResizeHandle";
import { PdfJsPreview, type PdfJsPreviewHandle } from "../../components/PdfJsPreview";
import { Select } from "../../components/Select";
import { useHorizontalRatioResize } from "../../hooks/useHorizontalRatioResize";
import { useI18n } from "../../i18n";
import { findAllTextMatches } from "../../lib/markdownSearch";
import { usePersistentState } from "../../lib/storage";

interface DocsSplitWorkbenchProps {
  isEditableText: boolean;
  liveHeightPx: number;
  editorText: string;
  editorLanguage?: EditorLanguage;
  onChangeEditorLanguage?: (lang: EditorLanguage) => void;
  saveExtension?: string;
  saveFeedback: string | null;
  previewLoading: boolean;
  previewError: string | null;
  previewPdfBytes: Uint8Array | null;
  previewTotalPages: number;
  syncScroll: boolean;
  editorFindOpen: boolean;
  editorFindQuery: string;
  activeEditorMatchIdx: number | null;
  editorMatchCount: number;
  previewFindOpen: boolean;
  previewFindQuery: string;
  activePreviewMatchIdx: number | null;
  previewMatchCount: number;
  editorRef: React.RefObject<MarkdownCodeEditorHandle | null>;
  previewRef: React.RefObject<PdfJsPreviewHandle | null>;
  editorPaneRef: React.RefObject<HTMLDivElement | null>;
  previewPaneRef: React.RefObject<HTMLDivElement | null>;
  editorFindInputRef: React.RefObject<HTMLInputElement | null>;
  previewFindInputRef: React.RefObject<HTMLInputElement | null>;
  onChangeEditorText: (val: string) => void;
  onSaveText: (saveAs: boolean) => void;
  onOpenEditorFind: () => void;
  onChangeEditorFindQuery: (val: string) => void;
  onStepEditorMatch: (delta: number) => void;
  onCloseEditorFind: () => void;
  onOpenPreviewFind: () => void;
  onChangePreviewFindQuery: (val: string) => void;
  onStepPreviewMatch: (delta: number) => void;
  onClosePreviewFind: () => void;
  onRefreshPreview: () => void;
  onPageCountChange: (count: number) => void;
  onSearchMatchCountChange: (count: number) => void;
  onToggleSyncScroll: (checked: boolean) => void;
  onEditorScrollRatio: (ratio: number) => void;
  onPreviewScrollRatio: (ratio: number) => void;
  onGoToInEditor: (selectedText: string, occurrenceIndex?: number) => void;
  onStartHeightResize: (e: React.PointerEvent<HTMLElement>) => void;
  pickPointActive?: boolean;
  pickedPoint?: { x: number; y: number } | null;
  onPickPoint?: (normX: number, normY: number) => void;
}

export const DocsSplitWorkbench: React.FC<DocsSplitWorkbenchProps> = ({
  isEditableText,
  liveHeightPx,
  editorText,
  editorLanguage = "markdown",
  onChangeEditorLanguage,
  saveExtension,
  saveFeedback,
  previewLoading,
  previewError,
  previewPdfBytes,
  previewTotalPages,
  syncScroll,
  editorFindOpen,
  editorFindQuery,
  activeEditorMatchIdx,
  editorMatchCount,
  previewFindOpen,
  previewFindQuery,
  activePreviewMatchIdx,
  previewMatchCount,
  editorRef,
  previewRef,
  editorPaneRef,
  previewPaneRef,
  editorFindInputRef,
  previewFindInputRef,
  onChangeEditorText,
  onSaveText,
  onOpenEditorFind,
  onChangeEditorFindQuery,
  onStepEditorMatch,
  onCloseEditorFind,
  onOpenPreviewFind,
  onChangePreviewFindQuery,
  onStepPreviewMatch,
  onClosePreviewFind,
  onRefreshPreview,
  onPageCountChange,
  onSearchMatchCountChange,
  onToggleSyncScroll,
  onEditorScrollRatio,
  onPreviewScrollRatio,
  onGoToInEditor,
  onStartHeightResize,
  pickPointActive = false,
  pickedPoint = null,
  onPickPoint,
}) => {
  const { t } = useI18n();
  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const [syntaxSummary, setSyntaxSummary] = React.useState<EditorSyntaxSummary>({
    count: 0,
    firstLine: null,
    firstFrom: null,
    firstTo: null,
    firstMessage: null,
  });
  const syntaxErrorCount = syntaxSummary.count;
  const [leftRatio, setLeftRatio] = usePersistentState<number>("knit.docs.leftRatio", 0.5);
  const { ratio: liveLeftRatio, handlePointerDown: handleStartWidthResize } =
    useHorizontalRatioResize({
      value: leftRatio,
      min: 0.25,
      max: 0.75,
      containerRef: splitContainerRef,
      cssVar: "--docs-left",
      onCommit: setLeftRatio,
    });

  const activeExt = saveExtension ?? editorLanguageExtension(editorLanguage);
  const langLabel = t.docs2pdf.editorLanguages[editorLanguage];

  const previewErrorLocation = React.useMemo(() => {
    if (!isEditableText || !previewError || !editorText) return null;
    const nearMatch = previewError.match(/near `([^`]+)`/);
    if (!nearMatch) return null;
    const rawSnippet = nearMatch[1].trim();
    const unescapedSnippet = rawSnippet.replace(/\\([\\/#*_`@$~<>[\]()])/g, "$1");
    const candidates = [rawSnippet, unescapedSnippet].filter(Boolean);
    for (const q of candidates) {
      const hits = findAllTextMatches(editorText, q);
      if (hits.length > 0) {
        const hit = hits[0];
        const line = editorText.slice(0, hit.from).split("\n").length;
        return { from: hit.from, to: hit.to, line };
      }
    }
    return null;
  }, [editorText, isEditableText, previewError]);

  return (
    <div className="space-y-2">
      <div
        ref={splitContainerRef}
        style={
          isEditableText
            ? ({
                height: `${liveHeightPx}px`,
                "--docs-left": `${(liveLeftRatio * 100).toFixed(2)}%`,
              } as React.CSSProperties)
            : { height: `${liveHeightPx}px` }
        }
        className={`grid min-h-[320px] grid-cols-1 gap-4 ${
          isEditableText
            ? "lg:gap-2 lg:[grid-template-columns:var(--docs-left)_12px_minmax(0,1fr)]"
            : "lg:grid-cols-1"
        }`}
      >
        {/* Left: Live Markdown Editor */}
        {isEditableText && (
          <>
            <div
              ref={editorPaneRef}
              className="knit-card flex min-h-0 flex-col overflow-hidden"
            >
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#343A40]">
                <FileCode2 className="h-4 w-4 text-[#007BFF]" />
                <span>{t.docs2pdf.editorTitleByLang(langLabel)}</span>
                {onChangeEditorLanguage && (
                  <Select
                    ariaLabel={t.docs2pdf.editorLanguageLabel}
                    size="sm"
                    value={editorLanguage}
                    onChange={(val) => onChangeEditorLanguage(val as EditorLanguage)}
                    className="w-32"
                    options={EDITOR_LANGUAGE_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: t.docs2pdf.editorLanguages[opt.value],
                    }))}
                  />
                )}
                {syntaxErrorCount > 0 && (
                  <button
                    type="button"
                    data-testid="editor-syntax-error-badge"
                    title={syntaxSummary.firstMessage ?? t.docs2pdf.jumpToErrorLineTitle}
                    onClick={() => {
                      if (syntaxSummary.firstFrom !== null) {
                        editorRef.current?.jumpToRange(
                          syntaxSummary.firstFrom,
                          syntaxSummary.firstTo ?? syntaxSummary.firstFrom,
                          true,
                        );
                      }
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-2 py-0.5 text-xs font-semibold text-[#842029] hover:bg-[#F1B0B7]"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {syntaxSummary.firstLine !== null
                      ? t.docs2pdf.syntaxErrorBadgeWithLine(syntaxErrorCount, syntaxSummary.firstLine)
                      : t.docs2pdf.syntaxErrorCount(syntaxErrorCount)}
                  </button>
                )}
                {syntaxErrorCount === 0 && previewErrorLocation && (
                  <button
                    type="button"
                    data-testid="preview-error-jump-badge"
                    title={previewError ?? t.docs2pdf.jumpToErrorLineTitle}
                    onClick={() => {
                      editorRef.current?.jumpToRange(
                        previewErrorLocation.from,
                        previewErrorLocation.to,
                        true,
                      );
                    }}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-2 py-0.5 text-xs font-semibold text-[#842029] hover:bg-[#F1B0B7]"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t.docs2pdf.syntaxErrorBadgeWithLine(1, previewErrorLocation.line)}
                  </button>
                )}
                {saveFeedback && (
                  <span className="rounded-[4px] bg-[#D4EDDA] px-2 py-0.5 text-xs font-semibold text-[#155724]">
                    {saveFeedback}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenEditorFind}
                  title="Ctrl+F"
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  <Search className="h-3.5 w-3.5 text-[#007BFF]" />
                </button>
                <button
                  type="button"
                  onClick={() => onSaveText(false)}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  <Save className="h-3.5 w-3.5 text-[#007BFF]" />
                  {t.docs2pdf.saveFileBtn(activeExt)}
                </button>
                <button
                  type="button"
                  onClick={() => onSaveText(true)}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  {t.docs2pdf.saveMdAsBtn}
                </button>
              </div>
            </div>

            <DocumentFindBar
              open={editorFindOpen}
              query={editorFindQuery}
              activeMatchIndex={activeEditorMatchIdx}
              matchCount={editorMatchCount}
              placeholder={t.docs2pdf.findEditorPlaceholder}
              prevTitle={t.docs2pdf.findPrevTitle}
              nextTitle={t.docs2pdf.findNextTitle}
              closeAriaLabel={t.common.close}
              counterColorClass="text-[#0056B3]"
              inputRef={editorFindInputRef}
              onQueryChange={onChangeEditorFindQuery}
              onPrev={() => onStepEditorMatch(-1)}
              onNext={() => onStepEditorMatch(1)}
              onClose={onCloseEditorFind}
            />

            <MarkdownCodeEditor
              ref={editorRef}
              value={editorText}
              language={editorLanguage}
              onChange={onChangeEditorText}
              onSave={() => onSaveText(false)}
              onOpenFind={onOpenEditorFind}
              onScrollRatioChange={onEditorScrollRatio}
              onDiagnosticsDetailChange={setSyntaxSummary}
              placeholder={t.docs2pdf.newDocPlaceholder}
            />
          </div>
          <PaneResizeHandle
            orientation="vertical"
            title={t.pdfOps.resizeWidthTitle}
            ariaLabel={t.pdfOps.resizeWidthTitle}
            onPointerDown={handleStartWidthResize}
          />
          </>
        )}

        {/* Right: Live PDF Preview via pdfjs-dist */}
        <div
          ref={previewPaneRef}
          className="knit-card flex min-h-0 flex-col overflow-hidden"
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
                    onChange={(e) => onToggleSyncScroll(e.target.checked)}
                  />
                  {t.docs2pdf.syncScrollLabel}
                </label>
              )}
              <button
                type="button"
                onClick={onOpenPreviewFind}
                title="Ctrl+F"
                className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
              >
                <Search className="h-3.5 w-3.5 text-[#007BFF]" />
              </button>
              <button
                type="button"
                disabled={previewLoading}
                onClick={onRefreshPreview}
                className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewLoading ? "animate-spin" : ""}`} />
                {t.docs2pdf.refreshPreviewBtn}
              </button>
            </div>
          </div>

          <DocumentFindBar
            open={previewFindOpen}
            query={previewFindQuery}
            activeMatchIndex={activePreviewMatchIdx}
            matchCount={previewMatchCount}
            placeholder={t.docs2pdf.findPreviewPlaceholder}
            prevTitle={t.docs2pdf.findPrevTitle}
            nextTitle={t.docs2pdf.findNextTitle}
            closeAriaLabel={t.common.close}
            counterColorClass="text-[#856404]"
            inputRef={previewFindInputRef}
            onQueryChange={onChangePreviewFindQuery}
            onPrev={() => onStepPreviewMatch(-1)}
            onNext={() => onStepPreviewMatch(1)}
            onClose={onClosePreviewFind}
          />

          <div className="min-h-0 flex-1">
            <PdfJsPreview
              ref={previewRef}
              pdfBytes={previewPdfBytes}
              loading={previewLoading}
              error={previewError}
              emptyText={t.docs2pdf.previewEmpty}
              loadingText={t.docs2pdf.previewRendering}
              onPageCountChange={onPageCountChange}
              searchQuery={previewFindOpen ? previewFindQuery : ""}
              activeMatchIndex={activePreviewMatchIdx}
              onSearchMatchCountChange={onSearchMatchCountChange}
              copyTextLabel={t.docs2pdf.copyText}
              goToInEditorLabel={t.docs2pdf.gotoInEditor}
              onGoToInEditor={isEditableText ? onGoToInEditor : undefined}
              onScrollRatioChange={onPreviewScrollRatio}
              onOpenFind={onOpenPreviewFind}
              pickPointActive={pickPointActive}
              pickedPoint={pickedPoint}
              pickPointHint={t.docs2pdf.htmlStepPickBanner}
              onPickPoint={onPickPoint}
            />
          </div>
        </div>
      </div>

      <PaneResizeHandle
        orientation="horizontal"
        variant="dashed"
        ariaLabel="Resize editor and preview height"
        title={`${liveHeightPx}px`}
        labelText={`${liveHeightPx}px`}
        onPointerDown={onStartHeightResize}
      />
    </div>
  );
};
