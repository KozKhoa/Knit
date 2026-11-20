import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  FolderOutput,
  Globe,
  RotateCcw,
  ScrollText,
  Settings2,
  Type,
} from "lucide-react";
import { NumberInput } from "../components/NumberInput";
import { Slider } from "../components/Slider";
import { ViewHeader } from "../components/ViewHeader";
import { useI18n } from "../i18n";
import { isTauriRuntime, pickDirectory, validateExportDirectory } from "../lib/ipc";
import type { AppFontFamily, LogVerbosity } from "../types/ipc";

interface SettingsViewProps {
  fontFamily: AppFontFamily;
  onChangeFontFamily: (font: AppFontFamily) => void;
  fontSizePx: number;
  onChangeFontSizePx: (size: number) => void;
  logVerbosity?: LogVerbosity;
  onChangeLogVerbosity?: (level: LogVerbosity) => void;
  defaultExportDir?: string;
  onChangeDefaultExportDir?: (dir: string) => void;
}

const FONT_FAMILIES: { id: AppFontFamily; previewStyle: string }[] = [
  { id: "lora", previewStyle: '"Lora", Georgia, serif' },
  { id: "afacad", previewStyle: '"Afacad", sans-serif' },
  { id: "roboto", previewStyle: '"Roboto", sans-serif' },
  {
    id: "system",
    previewStyle: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
];

const SIZE_PRESETS = [14, 15, 16, 18, 20];

export const SettingsView: React.FC<SettingsViewProps> = ({
  fontFamily,
  onChangeFontFamily,
  fontSizePx,
  onChangeFontSizePx,
  logVerbosity = "normal",
  onChangeLogVerbosity,
  defaultExportDir = "",
  onChangeDefaultExportDir,
}) => {
  const { lang, setLang, t } = useI18n();
  const [draftFontSize, setDraftFontSize] = React.useState(fontSizePx);
  const [draftExportDir, setDraftExportDir] = React.useState(defaultExportDir);
  const [exportDirWarning, setExportDirWarning] = React.useState<string | null>(null);
  const [exportDirVerified, setExportDirVerified] = React.useState(false);

  React.useEffect(() => {
    setDraftFontSize(fontSizePx);
  }, [fontSizePx]);

  React.useEffect(() => {
    setDraftExportDir(defaultExportDir);
    if (!defaultExportDir.trim()) {
      setExportDirWarning(null);
      setExportDirVerified(false);
      return;
    }
    if (!isTauriRuntime()) {
      setExportDirVerified(true);
      setExportDirWarning(null);
      return;
    }
    let cancelled = false;
    void validateExportDirectory(defaultExportDir)
      .then((res) => {
        if (cancelled) return;
        if (res.writable) {
          setExportDirVerified(true);
          setExportDirWarning(null);
        } else {
          setExportDirVerified(false);
          setExportDirWarning(res.error || t.settings.exportDirInvalidError);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setExportDirVerified(false);
          setExportDirWarning(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [defaultExportDir, t.settings.exportDirInvalidError]);

  const verifyAndSaveExportDir = async (candidateRaw: string) => {
    const trimmed = candidateRaw.trim();
    if (!trimmed) {
      setExportDirWarning(null);
      setExportDirVerified(false);
      onChangeDefaultExportDir?.("");
      return;
    }
    if (!isTauriRuntime()) {
      setExportDirVerified(true);
      setExportDirWarning(null);
      onChangeDefaultExportDir?.(trimmed);
      return;
    }
    try {
      const status = await validateExportDirectory(trimmed);
      if (status.writable) {
        setExportDirVerified(true);
        setExportDirWarning(null);
        onChangeDefaultExportDir?.(trimmed);
      } else {
        setExportDirVerified(false);
        setExportDirWarning(status.error || t.settings.exportDirInvalidError);
      }
    } catch (e) {
      setExportDirVerified(false);
      setExportDirWarning(String(e));
    }
  };

  const handleBrowseExportDir = async () => {
    try {
      const picked = await pickDirectory(t.settings.exportDirHeading);
      if (!picked) return;
      setDraftExportDir(picked);
      await verifyAndSaveExportDir(picked);
    } catch (e) {
      setExportDirWarning(String(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <ViewHeader title={t.settings.title} subtitle={t.settings.subtitle} />

      {/* Language Setting */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-[#007BFF]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#343A40]">
            {t.settings.languageHeading}
          </h2>
        </div>
        <p className="text-xs text-[#6C757D]">{t.settings.languageDesc}</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { code: "vi", label: t.settings.viLabel },
              { code: "en", label: t.settings.enLabel },
            ] as const
          ).map((item) => {
            const active = lang === item.code;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => setLang(item.code)}
                className={`knit-control inline-flex items-center rounded-[4px] border px-4 text-sm font-semibold transition-colors ${
                  active
                    ? "border-[#007BFF] bg-[#007BFF] text-white"
                    : "border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#F8F9FA]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Primary Font Family Setting */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-[#007BFF]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#343A40]">
            {t.settings.fontFamilyHeading}
          </h2>
        </div>
        <p className="text-xs text-[#6C757D]">{t.settings.fontFamilyDesc}</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {FONT_FAMILIES.map((item) => {
            const meta = t.settings.fontOptions[item.id];
            const active = fontFamily === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeFontFamily(item.id)}
                className={`flex items-center justify-between rounded-[4px] border p-3 text-left transition-colors ${
                  active
                    ? "border-[#007BFF] bg-[#E7F1FF]/60 ring-1 ring-[#007BFF]"
                    : "border-[#DEE2E6] bg-white hover:bg-[#F8F9FA]"
                }`}
                style={{ fontFamily: item.previewStyle }}
              >
                <div>
                  <div className="text-sm font-bold text-[#212529]">{meta.label}</div>
                  <div className="text-xs text-[#6C757D]">{meta.desc}</div>
                </div>
                <span className="text-lg font-semibold text-[#343A40]">Aa</span>
              </button>
            );
          })}
        </div>
        <div className="rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] px-3 py-2 text-xs text-[#6C757D]">
          {t.settings.monospaceNote}
        </div>
      </section>

      {/* App Font Size Setting */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-[#007BFF]" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#343A40]">
              {t.settings.fontSizeHeading}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onChangeFontSizePx(16)}
            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#F8F9FA]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t.settings.fontSizeReset}
          </button>
        </div>
        <p className="text-xs text-[#6C757D]">{t.settings.fontSizeDesc}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Slider
            ariaLabel={t.settings.fontSizeHeading}
            min={13}
            max={20}
            step={1}
            value={draftFontSize}
            onChange={setDraftFontSize}
            onValueCommit={(v) => {
              if (v !== fontSizePx) onChangeFontSizePx(v);
            }}
            className="w-48"
          />
          <NumberInput
            ariaLabel="Font size px"
            min={13}
            max={20}
            value={draftFontSize}
            onChange={(v) => {
              setDraftFontSize(v);
              onChangeFontSizePx(v);
            }}
            className="w-22"
          />
          <span className="font-mono-code text-xs text-[#6C757D]">px</span>

          <div className="flex flex-wrap items-center gap-1.5">
            {SIZE_PRESETS.map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => onChangeFontSizePx(sz)}
                className={`knit-control-sm rounded-[4px] border px-2.5 font-mono-code text-xs font-semibold ${
                  fontSizePx === sz
                    ? "border-[#007BFF] bg-[#007BFF] text-white"
                    : "border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#F8F9FA]"
                }`}
              >
                {sz}px
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Activity Logs Verbosity Setting */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-[#007BFF]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#343A40]">
            {t.settings.logVerbosityHeading}
          </h2>
        </div>
        <p className="text-xs text-[#6C757D]">{t.settings.logVerbosityDesc}</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          {(["minimal", "normal", "detailed"] as LogVerbosity[]).map((level) => {
            const meta = t.settings.logVerbosityOptions[level];
            const active = logVerbosity === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => onChangeLogVerbosity?.(level)}
                className={`rounded-[4px] border p-3 text-left transition-colors ${
                  active
                    ? "border-[#007BFF] bg-[#E7F1FF]/60 ring-1 ring-[#007BFF]"
                    : "border-[#DEE2E6] bg-white hover:bg-[#F8F9FA]"
                }`}
              >
                <div className="text-sm font-bold text-[#212529]">{meta.label}</div>
                <div className="mt-1 text-xs text-[#6C757D]">{meta.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Default Export Directory Setting */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FolderOutput className="h-4 w-4 text-[#007BFF]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-[#343A40]">
            {t.settings.exportDirHeading}
          </h2>
        </div>
        <p className="text-xs text-[#6C757D]">{t.settings.exportDirDesc}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draftExportDir}
            onChange={(e) => {
              setDraftExportDir(e.target.value);
              setExportDirWarning(null);
            }}
            placeholder={t.settings.exportDirPlaceholder}
            className="knit-control min-w-[240px] flex-1 rounded-[4px] border border-[#CED4DA] px-3 font-mono-code text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleBrowseExportDir()}
            className="knit-control inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-3 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t.settings.exportDirBrowseBtn}
          </button>
          <button
            type="button"
            onClick={() => void verifyAndSaveExportDir(draftExportDir)}
            className="knit-control rounded-[4px] bg-[#007BFF] px-3.5 text-xs font-semibold text-white hover:bg-[#0069D9]"
          >
            {t.settings.exportDirSaveBtn}
          </button>
          {(draftExportDir.trim() !== "" || defaultExportDir.trim() !== "") && (
            <button
              type="button"
              onClick={() => {
                setDraftExportDir("");
                setExportDirWarning(null);
                setExportDirVerified(false);
                onChangeDefaultExportDir?.("");
              }}
              className="knit-control rounded-[4px] border border-[#CED4DA] bg-white px-3 text-xs font-semibold text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              {t.settings.exportDirClearBtn}
            </button>
          )}
        </div>

        {exportDirWarning && (
          <div className="flex items-center gap-2 rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3 py-2 text-xs text-[#721C24]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{exportDirWarning}</span>
          </div>
        )}

        {!exportDirWarning && exportDirVerified && defaultExportDir.trim() !== "" && (
          <div className="flex items-center gap-2 rounded-[4px] border border-[#C3E6CB] bg-[#D4EDDA] px-3 py-2 text-xs text-[#155724]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {t.settings.exportDirValidBadge}:{" "}
              <code className="font-mono-code font-semibold">{defaultExportDir}</code>
            </span>
          </div>
        )}

        {!exportDirWarning && defaultExportDir.trim() === "" && (
          <div className="rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] px-3 py-2 text-xs text-[#6C757D]">
            {t.settings.exportDirEmptyNote}
          </div>
        )}
      </section>

      {/* Typography Preview */}
      <section className="rounded-[4px] border border-[#DEE2E6] bg-white p-4 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-[#6C757D]">
          {t.settings.previewHeading}
        </div>
        <div className="text-lg font-bold text-[#212529]">{t.settings.previewTitle}</div>
        <p className="text-sm text-[#495057]">{t.settings.previewBody}</p>
        <div className="rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] px-3 py-2 font-mono-code text-xs text-[#343A40]">
          {t.settings.previewCode}
        </div>
      </section>
    </div>
  );
};
