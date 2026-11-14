import React from "react";
import { Globe, RotateCcw, Settings2, Type } from "lucide-react";
import { NumberInput } from "../components/NumberInput";
import { Slider } from "../components/Slider";
import { useI18n } from "../i18n";
import type { AppFontFamily } from "../types/ipc";

interface SettingsViewProps {
  fontFamily: AppFontFamily;
  onChangeFontFamily: (font: AppFontFamily) => void;
  fontSizePx: number;
  onChangeFontSizePx: (size: number) => void;
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
}) => {
  const { lang, setLang, t } = useI18n();
  const [draftFontSize, setDraftFontSize] = React.useState(fontSizePx);

  React.useEffect(() => {
    setDraftFontSize(fontSizePx);
  }, [fontSizePx]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[#212529]">{t.settings.title}</h1>
        <p className="text-sm text-[#6C757D]">{t.settings.subtitle}</p>
      </div>

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
