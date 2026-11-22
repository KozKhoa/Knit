import React from "react";
import { Crosshair } from "lucide-react";
import { NumberInput } from "../../components/NumberInput";
import { Select } from "../../components/Select";
import { useI18n } from "../../i18n";
import { MERMAID_THEMES, type MermaidTheme } from "../../lib/mermaid";
import type {
  DocFont,
  DocTheme,
  HtmlRenderMode,
  HtmlStepKind,
  PageNumberFormat,
  PageNumberPosition,
  PageOrientation,
  PageSizePreset,
} from "../../types/ipc";

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

interface Docs2PdfSettingsCardProps {
  disabled?: boolean;
  isHtmlFile?: boolean;
  htmlRenderMode?: HtmlRenderMode;
  onChangeHtmlRenderMode?: (val: HtmlRenderMode) => void;
  htmlStepKind?: HtmlStepKind;
  htmlStepKey?: string;
  htmlStepSelector?: string;
  htmlStepClickX?: number;
  htmlStepClickY?: number;
  pickingClickPoint?: boolean;
  onChangeHtmlStepKind?: (val: HtmlStepKind) => void;
  onChangeHtmlStepKey?: (val: string) => void;
  onChangeHtmlStepSelector?: (val: string) => void;
  onChangeHtmlStepClickX?: (val: number) => void;
  onChangeHtmlStepClickY?: (val: number) => void;
  onTogglePickClickPoint?: () => void;
  theme: DocTheme;
  pdfFont: DocFont;
  mermaidTheme: MermaidTheme;
  pageSize: PageSizePreset;
  orientation: PageOrientation;
  marginMm: number;
  fontSizePt: number;
  lineSpacing: number;
  titleOverride: string;
  includeToc: boolean;
  tocPage: number;
  maxTocPage?: number;
  pageNumEnabled: boolean;
  pageNumPosition: PageNumberPosition;
  pageNumFormat: PageNumberFormat;
  pageNumStartNumber: number;
  pageNumStartFromPage: number;
  onChangeTheme: (val: DocTheme) => void;
  onChangePdfFont: (val: DocFont) => void;
  onChangeMermaidTheme: (val: MermaidTheme) => void;
  onChangePageSize: (val: PageSizePreset) => void;
  onChangeOrientation: (val: PageOrientation) => void;
  onChangeMarginMm: (val: number) => void;
  onChangeFontSizePt: (val: number) => void;
  onChangeLineSpacing: (val: number) => void;
  onChangeTitleOverride: (val: string) => void;
  onChangeIncludeToc: (checked: boolean) => void;
  onChangeTocPage: (val: number) => void;
  onChangePageNumEnabled: (checked: boolean) => void;
  onChangePageNumPosition: (val: PageNumberPosition) => void;
  onChangePageNumFormat: (val: PageNumberFormat) => void;
  onChangePageNumStartNumber: (val: number) => void;
  onChangePageNumStartFromPage: (val: number) => void;
}

export const Docs2PdfSettingsCard: React.FC<Docs2PdfSettingsCardProps> = ({
  disabled = false,
  isHtmlFile = false,
  htmlRenderMode = "auto",
  onChangeHtmlRenderMode,
  htmlStepKind = "auto_key",
  htmlStepKey = "Space",
  htmlStepSelector = "",
  htmlStepClickX = 0.85,
  htmlStepClickY = 0.5,
  pickingClickPoint = false,
  onChangeHtmlStepKind,
  onChangeHtmlStepKey,
  onChangeHtmlStepSelector,
  onChangeHtmlStepClickX,
  onChangeHtmlStepClickY,
  onTogglePickClickPoint,
  theme,
  pdfFont,
  mermaidTheme,
  pageSize,
  orientation,
  marginMm,
  fontSizePt,
  lineSpacing,
  titleOverride,
  includeToc,
  tocPage,
  maxTocPage,
  pageNumEnabled,
  pageNumPosition,
  pageNumFormat,
  pageNumStartNumber,
  pageNumStartFromPage,
  onChangeTheme,
  onChangePdfFont,
  onChangeMermaidTheme,
  onChangePageSize,
  onChangeOrientation,
  onChangeMarginMm,
  onChangeFontSizePt,
  onChangeLineSpacing,
  onChangeTitleOverride,
  onChangeIncludeToc,
  onChangeTocPage,
  onChangePageNumEnabled,
  onChangePageNumPosition,
  onChangePageNumFormat,
  onChangePageNumStartNumber,
  onChangePageNumStartFromPage,
}) => {
  const { t } = useI18n();

  return (
    <div className="knit-card p-4">
      <fieldset
        disabled={disabled}
        className={`space-y-3.5 border-0 p-0 m-0 min-w-0 ${
          disabled ? "opacity-55 pointer-events-none select-none" : ""
        }`}
      >
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-4 xl:grid-cols-8">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.themeLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.themeLabel}
            value={theme}
            onChange={(val) => onChangeTheme(val as DocTheme)}
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
            onChange={(val) => onChangePdfFont(val as DocFont)}
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
            onChange={(val) => onChangeMermaidTheme(val as MermaidTheme)}
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
            onChange={(val) => onChangePageSize(val as PageSizePreset)}
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
            {t.docs2pdf.orientationLabel}
          </label>
          <Select
            ariaLabel={t.docs2pdf.orientationLabel}
            value={orientation}
            onChange={(val) => onChangeOrientation(val as PageOrientation)}
            className="mt-1 w-full"
            options={[
              { value: "portrait", label: t.docs2pdf.orientations.portrait },
              { value: "landscape", label: t.docs2pdf.orientations.landscape },
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
            onChange={onChangeMarginMm}
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
            onChange={onChangeFontSizePt}
            className="mt-1 w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.lineSpacingLabel}
          </label>
          <NumberInput
            ariaLabel={t.docs2pdf.lineSpacingLabel}
            min={0.8}
            max={3.0}
            step={0.05}
            value={lineSpacing}
            onChange={onChangeLineSpacing}
            className="mt-1 w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 border-t border-[#E9ECEF] pt-3 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-5">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.docs2pdf.titleAndTocLabel}
          </label>
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="text"
              placeholder={t.docs2pdf.titlePlaceholder}
              value={titleOverride}
              onChange={(e) => onChangeTitleOverride(e.target.value)}
              className="knit-control knit-input min-w-[180px] flex-1 px-2.5 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-[#212529]">
              <input
                type="checkbox"
                checked={includeToc}
                onChange={(e) => onChangeIncludeToc(e.target.checked)}
              />
              {t.docs2pdf.includeTocLabel}
            </label>
            {includeToc && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-[#495057]">
                  {t.docs2pdf.tocPageLabel}:
                </span>
                <NumberInput
                  ariaLabel={t.docs2pdf.tocPageLabel}
                  size="sm"
                  min={1}
                  max={Math.max(1, maxTocPage ?? 999)}
                  value={tocPage}
                  onChange={onChangeTocPage}
                  className="w-20"
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 lg:col-span-7">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase text-[#6C757D]">
              {t.docs2pdf.pageNumberingLabel}
            </span>
            <label className="flex items-center gap-2 text-sm font-medium text-[#212529]">
              <input
                type="checkbox"
                checked={pageNumEnabled}
                onChange={(e) => onChangePageNumEnabled(e.target.checked)}
              />
              {t.docs2pdf.pageNumberEnabledLabel}
            </label>
          </div>

          {pageNumEnabled && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div>
                <label className="block text-[11px] font-medium text-[#6C757D]">
                  {t.docs2pdf.pageNumberPosLabel}
                </label>
                <Select
                  ariaLabel={t.docs2pdf.pageNumberPosLabel}
                  size="sm"
                  value={pageNumPosition}
                  onChange={(val) => onChangePageNumPosition(val as PageNumberPosition)}
                  className="mt-1 w-full"
                  options={(
                    [
                      "bottom_center",
                      "bottom_right",
                      "bottom_left",
                      "top_center",
                      "top_left",
                      "top_right",
                    ] as PageNumberPosition[]
                  ).map((pos) => ({
                    value: pos,
                    label: t.docs2pdf.pageNumberPositions[pos],
                  }))}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6C757D]">
                  {t.docs2pdf.pageNumberFormatLabel}
                </label>
                <Select
                  ariaLabel={t.docs2pdf.pageNumberFormatLabel}
                  size="sm"
                  value={pageNumFormat}
                  onChange={(val) => onChangePageNumFormat(val as PageNumberFormat)}
                  className="mt-1 w-full"
                  options={(
                    ["number_only", "page_of_total", "page_label"] as PageNumberFormat[]
                  ).map((fmt) => ({
                    value: fmt,
                    label: t.docs2pdf.pageNumberFormats[fmt],
                  }))}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6C757D]">
                  {t.docs2pdf.pageNumberStartNumLabel}
                </label>
                <NumberInput
                  ariaLabel={t.docs2pdf.pageNumberStartNumLabel}
                  size="sm"
                  min={0}
                  max={9999}
                  value={pageNumStartNumber}
                  onChange={onChangePageNumStartNumber}
                  className="mt-1 w-full"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6C757D]">
                  {t.docs2pdf.pageNumberStartPageLabel}
                </label>
                <NumberInput
                  ariaLabel={t.docs2pdf.pageNumberStartPageLabel}
                  size="sm"
                  min={1}
                  max={9999}
                  value={pageNumStartFromPage}
                  onChange={onChangePageNumStartFromPage}
                  className="mt-1 w-full"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {isHtmlFile && onChangeHtmlRenderMode && (
        <div className="space-y-3 border-t border-[#E9ECEF] pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[260px] flex-1 max-w-md">
              <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                {t.docs2pdf.htmlRenderModeLabel}
              </label>
              <Select
                ariaLabel={t.docs2pdf.htmlRenderModeLabel}
                value={htmlRenderMode}
                onChange={(val) => onChangeHtmlRenderMode(val as HtmlRenderMode)}
                className="mt-1 w-full"
                options={(["auto", "slide_step", "document_print"] as HtmlRenderMode[]).map((m) => ({
                  value: m,
                  label: t.docs2pdf.htmlRenderModes[m],
                }))}
              />
            </div>
            <p className="text-xs text-[#6C757D] mt-4">{t.docs2pdf.htmlRenderModeHint}</p>
          </div>

          {htmlRenderMode === "slide_step" && onChangeHtmlStepKind && (
            <div className="grid grid-cols-1 gap-3 rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] p-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                  {t.docs2pdf.htmlStepKindLabel}
                </label>
                <Select
                  ariaLabel={t.docs2pdf.htmlStepKindLabel}
                  size="sm"
                  value={htmlStepKind}
                  onChange={(val) => onChangeHtmlStepKind(val as HtmlStepKind)}
                  className="mt-1 w-full"
                  options={(
                    ["auto_key", "key", "click_selector", "click_point"] as HtmlStepKind[]
                  ).map((k) => ({
                    value: k,
                    label: t.docs2pdf.htmlStepKinds[k],
                  }))}
                />
              </div>

              {htmlStepKind === "key" && onChangeHtmlStepKey && (
                <div className="flex flex-wrap items-end gap-2 md:col-span-8">
                  <div className="min-w-[160px] flex-1">
                    <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                      {t.docs2pdf.htmlStepKeyLabel}
                    </label>
                    <Select
                      ariaLabel={t.docs2pdf.htmlStepKeyLabel}
                      size="sm"
                      value={
                        ["Space", "ArrowRight", "PageDown", "ArrowDown", "Enter"].includes(htmlStepKey)
                          ? htmlStepKey
                          : "__custom__"
                      }
                      onChange={(val) => {
                        if (val === "__custom__") {
                          if (["Space", "ArrowRight", "PageDown", "ArrowDown", "Enter"].includes(htmlStepKey)) {
                            onChangeHtmlStepKey("n");
                          }
                        } else {
                          onChangeHtmlStepKey(val);
                        }
                      }}
                      className="mt-1 w-full"
                      options={[
                        { value: "Space", label: "Space" },
                        { value: "ArrowRight", label: "ArrowRight" },
                        { value: "PageDown", label: "PageDown" },
                        { value: "ArrowDown", label: "ArrowDown" },
                        { value: "Enter", label: "Enter" },
                        { value: "__custom__", label: t.docs2pdf.htmlStepKeyCustomLabel },
                      ]}
                    />
                  </div>
                  {!["Space", "ArrowRight", "PageDown", "ArrowDown", "Enter"].includes(htmlStepKey) && (
                    <div className="min-w-[160px] flex-1">
                      <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                        {t.docs2pdf.htmlStepKeyCustomLabel}
                      </label>
                      <input
                        type="text"
                        aria-label={t.docs2pdf.htmlStepKeyCustomLabel}
                        placeholder={t.docs2pdf.htmlStepKeyCustomPlaceholder}
                        value={htmlStepKey}
                        onChange={(e) => onChangeHtmlStepKey(e.target.value)}
                        className="knit-control-sm knit-input mt-1 w-full px-2.5 font-mono-code text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {htmlStepKind === "click_selector" && onChangeHtmlStepSelector && (
                <div className="md:col-span-8">
                  <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                    {t.docs2pdf.htmlStepSelectorLabel}
                  </label>
                  <input
                    type="text"
                    aria-label={t.docs2pdf.htmlStepSelectorLabel}
                    placeholder={t.docs2pdf.htmlStepSelectorPlaceholder}
                    value={htmlStepSelector}
                    onChange={(e) => onChangeHtmlStepSelector(e.target.value)}
                    className="knit-control-sm knit-input mt-1 w-full px-2.5 font-mono-code text-xs"
                  />
                </div>
              )}

              {htmlStepKind === "click_point" &&
                onChangeHtmlStepClickX &&
                onChangeHtmlStepClickY && (
                  <div className="flex flex-wrap items-end gap-2.5 md:col-span-8">
                    <div className="w-28">
                      <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                        {t.docs2pdf.htmlStepClickXLabel}
                      </label>
                      <NumberInput
                        ariaLabel={t.docs2pdf.htmlStepClickXLabel}
                        size="sm"
                        min={0}
                        max={100}
                        step={0.5}
                        value={Math.round(htmlStepClickX * 1000) / 10}
                        onChange={(pct) =>
                          onChangeHtmlStepClickX(Math.min(1, Math.max(0, pct / 100)))
                        }
                        className="mt-1 w-full"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-[11px] font-semibold uppercase text-[#6C757D]">
                        {t.docs2pdf.htmlStepClickYLabel}
                      </label>
                      <NumberInput
                        ariaLabel={t.docs2pdf.htmlStepClickYLabel}
                        size="sm"
                        min={0}
                        max={100}
                        step={0.5}
                        value={Math.round(htmlStepClickY * 1000) / 10}
                        onChange={(pct) =>
                          onChangeHtmlStepClickY(Math.min(1, Math.max(0, pct / 100)))
                        }
                        className="mt-1 w-full"
                      />
                    </div>
                    {onTogglePickClickPoint && (
                      <button
                        type="button"
                        onClick={onTogglePickClickPoint}
                        className={`knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border px-3 text-xs font-semibold ${
                          pickingClickPoint
                            ? "border-[#007BFF] bg-[#007BFF] text-white"
                            : "border-[#CED4DA] bg-white text-[#212529] hover:bg-[#E9ECEF]"
                        }`}
                      >
                        <Crosshair className="h-3.5 w-3.5" />
                        {pickingClickPoint
                          ? t.docs2pdf.htmlStepPickingOnPreview
                          : t.docs2pdf.htmlStepPickOnPreview}
                      </button>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}
      </fieldset>
    </div>
  );
};
