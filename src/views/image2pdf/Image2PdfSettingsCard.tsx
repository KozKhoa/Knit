import React from "react";
import { NumberInput } from "../../components/NumberInput";
import { Select } from "../../components/Select";
import { Slider } from "../../components/Slider";
import { useI18n } from "../../i18n";
import type { AnimatedImagePolicy, PdfExportMode } from "../../types/ipc";

export type BgMode = "transparent" | "white" | "black" | "custom";
export type MarginUnit = "pt" | "mm";

interface Image2PdfSettingsCardProps {
  layoutMode: "original_size" | "fit_a4" | "fit_letter";
  dpi: number;
  marginValue: number;
  marginUnit: MarginUnit;
  bgMode: BgMode;
  bgCustomHex: string;
  exportMode: PdfExportMode;
  jpegQuality: number;
  losslessPassthrough: boolean;
  animatedPolicy: AnimatedImagePolicy;
  splitMode: "none" | "max_mb" | "max_pages_per_file";
  maxMb: string;
  maxPagesPerFile: number;
  loadThumbs: boolean;
  onChangeLayoutMode: (val: "original_size" | "fit_a4" | "fit_letter") => void;
  onChangeDpi: (val: number) => void;
  onChangeMarginValue: (val: number) => void;
  onSwitchMarginUnit: (unit: MarginUnit) => void;
  onChangeBgMode: (mode: BgMode) => void;
  onChangeBgCustomHex: (hex: string) => void;
  onChangeExportMode: (mode: PdfExportMode) => void;
  onChangeJpegQuality: (q: number) => void;
  onChangeLosslessPassthrough: (checked: boolean) => void;
  onChangeAnimatedPolicy: (policy: AnimatedImagePolicy) => void;
  onChangeSplitMode: (mode: "none" | "max_mb" | "max_pages_per_file") => void;
  onChangeMaxMb: (val: string) => void;
  onChangeMaxPagesPerFile: (val: number) => void;
  onChangeLoadThumbs: (checked: boolean) => void;
}

export const Image2PdfSettingsCard: React.FC<Image2PdfSettingsCardProps> = React.memo(({
  layoutMode,
  dpi,
  marginValue,
  marginUnit,
  bgMode,
  bgCustomHex,
  exportMode,
  jpegQuality,
  losslessPassthrough,
  animatedPolicy,
  splitMode,
  maxMb,
  maxPagesPerFile,
  loadThumbs,
  onChangeLayoutMode,
  onChangeDpi,
  onChangeMarginValue,
  onSwitchMarginUnit,
  onChangeBgMode,
  onChangeBgCustomHex,
  onChangeExportMode,
  onChangeJpegQuality,
  onChangeLosslessPassthrough,
  onChangeAnimatedPolicy,
  onChangeSplitMode,
  onChangeMaxMb,
  onChangeMaxPagesPerFile,
  onChangeLoadThumbs,
}) => {
  const { t } = useI18n();
  const exportModeHint =
    exportMode === "fast"
      ? t.image2pdf.exportModeFastHint
      : exportMode === "safe"
        ? t.image2pdf.exportModeSafeHint
        : t.image2pdf.exportModeBalancedHint;

  return (
    <div className="knit-card grid grid-cols-1 gap-3.5 p-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase text-[#6C757D]">
          {t.image2pdf.layoutHeading}
        </label>
        <Select
          ariaLabel={t.image2pdf.layoutHeading}
          value={layoutMode}
          onChange={(val) => onChangeLayoutMode(val as typeof layoutMode)}
          className="w-full"
          options={[
            { value: "original_size", label: t.image2pdf.layoutOriginal },
            { value: "fit_a4", label: t.image2pdf.layoutA4 },
            { value: "fit_letter", label: t.image2pdf.layoutLetter },
          ]}
        />

        {layoutMode === "original_size" ? (
          <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
            <span>{t.image2pdf.dpiLabel}</span>
            <NumberInput
              ariaLabel={t.image2pdf.dpiLabel}
              size="sm"
              min={36}
              max={600}
              value={dpi}
              onChange={onChangeDpi}
              className="w-24"
            />
          </label>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
              <span>{t.image2pdf.paddingLabel}</span>
              <div className="flex items-center gap-1">
                <NumberInput
                  ariaLabel={t.image2pdf.paddingLabel}
                  size="sm"
                  min={0}
                  max={marginUnit === "mm" ? 60 : 170}
                  step={marginUnit === "mm" ? 1 : 2}
                  value={marginValue}
                  onChange={onChangeMarginValue}
                  className="w-20"
                />
                <Select
                  ariaLabel="Padding unit"
                  size="sm"
                  value={marginUnit}
                  onChange={(val) => onSwitchMarginUnit(val as MarginUnit)}
                  className="font-mono-code"
                  options={[
                    { value: "mm", label: "mm" },
                    { value: "pt", label: "pt" },
                  ]}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
              <span>{t.image2pdf.bgColorLabel}</span>
              <div className="flex items-center gap-1.5">
                <Select
                  ariaLabel={t.image2pdf.bgColorLabel}
                  size="sm"
                  value={bgMode}
                  onChange={(val) => onChangeBgMode(val as BgMode)}
                  options={[
                    { value: "white", label: t.image2pdf.bgWhite },
                    { value: "black", label: t.image2pdf.bgBlack },
                    { value: "transparent", label: t.image2pdf.bgTransparent },
                    { value: "custom", label: t.image2pdf.bgCustom },
                  ]}
                />
                {bgMode === "custom" && (
                  <input
                    type="color"
                    value={bgCustomHex}
                    onChange={(e) => onChangeBgCustomHex(e.target.value)}
                    className="knit-control-sm w-9 cursor-pointer rounded-[4px] border border-[#CED4DA] bg-white p-0.5"
                    title={bgCustomHex}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase text-[#6C757D]">
          {t.image2pdf.qualityHeading}
        </label>
        <Select
          ariaLabel={t.image2pdf.exportModeLabel}
          value={exportMode}
          onChange={(val) => onChangeExportMode(val as PdfExportMode)}
          className="w-full"
          options={[
            { value: "fast", label: t.image2pdf.exportModeFast },
            { value: "balanced", label: t.image2pdf.exportModeBalanced },
            { value: "safe", label: t.image2pdf.exportModeSafe },
          ]}
        />
        <p className="text-[11px] leading-snug text-[#6C757D]">{exportModeHint}</p>
        <label className="flex items-center gap-2 text-sm text-[#212529]">
          <input
            type="checkbox"
            checked={exportMode === "fast" ? true : losslessPassthrough}
            disabled={exportMode === "fast"}
            onChange={(e) => onChangeLosslessPassthrough(e.target.checked)}
          />
          <span className={exportMode === "fast" ? "text-[#6C757D]" : ""}>
            {t.image2pdf.losslessLabel}
          </span>
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
          <span>{t.image2pdf.jpegQualityLabel(jpegQuality)}</span>
          <Slider
            ariaLabel="JPEG Quality"
            min={40}
            max={100}
            step={1}
            value={jpegQuality}
            onChange={onChangeJpegQuality}
            className="w-28"
          />
        </label>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase text-[#6C757D]">
          {t.image2pdf.animatedHeading}
        </label>
        <Select
          ariaLabel={t.image2pdf.animatedHeading}
          value={animatedPolicy}
          onChange={(val) => onChangeAnimatedPolicy(val as AnimatedImagePolicy)}
          className="w-full"
          options={[
            { value: "first_frame_only", label: t.image2pdf.animatedFirstFrame },
            { value: "unpack_all_frames", label: t.image2pdf.animatedUnpackAll },
          ]}
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase text-[#6C757D]">
          {t.image2pdf.splitMbHeading}
        </label>
        <Select
          ariaLabel={t.image2pdf.splitMbHeading}
          value={exportMode === "fast" ? "none" : splitMode}
          disabled={exportMode === "fast"}
          onChange={(val) =>
            onChangeSplitMode(val as "none" | "max_mb" | "max_pages_per_file")
          }
          className="w-full"
          options={[
            { value: "none", label: t.image2pdf.splitModeNone },
            { value: "max_mb", label: t.image2pdf.splitModeMb },
            { value: "max_pages_per_file", label: t.image2pdf.splitModePages },
          ]}
        />
        {exportMode === "fast" ? (
          <p className="text-[11px] leading-snug text-[#6C757D]">
            {t.image2pdf.exportModeFastSplitNotice}
          </p>
        ) : (
          <>
            {splitMode === "max_mb" && (
              <>
                <NumberInput
                  ariaLabel={t.image2pdf.splitModeMb}
                  min={0}
                  step={1}
                  value={maxMb.trim() !== "" && !Number.isNaN(Number(maxMb)) ? Number(maxMb) : 0}
                  onChange={(val) => onChangeMaxMb(val > 0 ? String(val) : "")}
                  className="w-full"
                />
                <p className="text-[11px] text-[#6C757D]">{t.image2pdf.splitMbPlaceholder}</p>
              </>
            )}
            {splitMode === "max_pages_per_file" && (
              <>
                <NumberInput
                  ariaLabel={t.image2pdf.splitModePages}
                  min={1}
                  step={1}
                  value={maxPagesPerFile}
                  onChange={onChangeMaxPagesPerFile}
                  className="w-full"
                />
                <p className="text-[11px] text-[#6C757D]">{t.image2pdf.splitPagesPlaceholder}</p>
              </>
            )}
          </>
        )}
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm font-medium text-[#212529]">
          <input
            type="checkbox"
            checked={loadThumbs}
            onChange={(e) => onChangeLoadThumbs(e.target.checked)}
          />
          <span>{t.image2pdf.loadThumbsLabel}</span>
        </label>
      </div>
    </div>
  );
});
