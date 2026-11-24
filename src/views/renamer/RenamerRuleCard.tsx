import React from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { Select } from "../../components/Select";
import { useI18n } from "../../i18n";
import type { FixedPresetKind, UserPreset } from "../../types/ipc";

const FIXED_PRESET_KEYS: FixedPresetKind[] = [
  "manga_chapter",
  "manga_volume",
  "pad2",
  "pad3",
  "clean_tags",
  "clean_whitespace",
  "normalize_extensions",
  "lowercase",
  "uppercase",
  "titlecase",
];

interface RenamerRuleCardProps {
  ruleMode: "find_replace" | "perl_prename" | "fixed_preset";
  findStr: string;
  replaceStr: string;
  matchCase: boolean;
  useRegex: boolean;
  perlExpr: string;
  fixedPreset: FixedPresetKind;
  presets: UserPreset[];
  newPresetTitle: string;
  onChangeRuleMode: (mode: "find_replace" | "perl_prename" | "fixed_preset") => void;
  onChangeFindStr: (val: string) => void;
  onChangeReplaceStr: (val: string) => void;
  onChangeMatchCase: (checked: boolean) => void;
  onChangeUseRegex: (checked: boolean) => void;
  onChangePerlExpr: (val: string) => void;
  onChangeFixedPreset: (val: FixedPresetKind) => void;
  onChangeNewPresetTitle: (val: string) => void;
  onSavePreset: () => void;
  onApplyPreset: (p: UserPreset) => void;
  onDeletePreset: (id: string) => void;
}

export const RenamerRuleCard: React.FC<RenamerRuleCardProps> = ({
  ruleMode,
  findStr,
  replaceStr,
  matchCase,
  useRegex,
  perlExpr,
  fixedPreset,
  presets,
  newPresetTitle,
  onChangeRuleMode,
  onChangeFindStr,
  onChangeReplaceStr,
  onChangeMatchCase,
  onChangeUseRegex,
  onChangePerlExpr,
  onChangeFixedPreset,
  onChangeNewPresetTitle,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}) => {
  const { t } = useI18n();

  return (
    <div className="knit-card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-[#343A40]">
          {t.renamer.ruleHeading}
        </span>
        <div className="flex gap-1">
          {(["find_replace", "perl_prename", "fixed_preset"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChangeRuleMode(m)}
              className={`rounded-[4px] px-2.5 py-1 text-xs font-semibold ${
                ruleMode === m
                  ? "bg-[#007BFF] text-white"
                  : "border border-[#CED4DA] bg-[#F8F9FA] text-[#495057]"
              }`}
            >
              {m === "find_replace"
                ? "Find/Replace"
                : m === "perl_prename"
                  ? "Prename"
                  : "Presets"}
            </button>
          ))}
        </div>
      </div>

      {ruleMode === "find_replace" && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t.renamer.findPlaceholder}
              value={findStr}
              onChange={(e) => onChangeFindStr(e.target.value)}
              className="knit-control knit-input px-2.5 text-xs"
            />
            <input
              type="text"
              placeholder={t.renamer.replacePlaceholder}
              value={replaceStr}
              onChange={(e) => onChangeReplaceStr(e.target.value)}
              className="knit-control knit-input px-2.5 text-xs"
            />
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => onChangeMatchCase(e.target.checked)}
              />
              {t.renamer.matchCaseLabel}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => onChangeUseRegex(e.target.checked)}
              />
              {t.renamer.useRegexLabel}
            </label>
          </div>
        </div>
      )}

      {ruleMode === "perl_prename" && (
        <div>
          <input
            type="text"
            value={perlExpr}
            onChange={(e) => onChangePerlExpr(e.target.value)}
            placeholder={t.renamer.prenamePlaceholder}
            className="knit-control knit-input w-full px-2.5 text-xs"
          />
          <div className="mt-1.5 text-xs text-[#6C757D]">{t.renamer.prenameHint}</div>
        </div>
      )}

      {ruleMode === "fixed_preset" && (
        <Select
          ariaLabel="Fixed preset"
          value={fixedPreset}
          onChange={(val) => onChangeFixedPreset(val as FixedPresetKind)}
          className="w-full"
          options={FIXED_PRESET_KEYS.map((key) => ({
            value: key,
            label: t.renamer.fixedPresets[key],
          }))}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[#E9ECEF] pt-2.5">
        <Bookmark className="h-4 w-4 text-[#6C757D]" />
        <input
          type="text"
          placeholder={t.renamer.savePresetPlaceholder}
          value={newPresetTitle}
          onChange={(e) => onChangeNewPresetTitle(e.target.value)}
          className="knit-control-sm knit-input w-40 px-2.5 text-xs"
        />
        <button
          type="button"
          onClick={onSavePreset}
          className="knit-control-sm knit-btn-secondary px-3 text-xs"
        >
          {t.renamer.savePresetBtn}
        </button>
        {presets.map((p) => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2 py-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => onApplyPreset(p)}
              className="font-semibold text-[#007BFF] hover:underline"
            >
              {p.title}
            </button>
            <button
              type="button"
              onClick={() => onDeletePreset(p.id)}
              className="text-[#DC3545]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
};
