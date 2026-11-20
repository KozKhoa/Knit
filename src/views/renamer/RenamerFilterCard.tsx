import React from "react";
import { Select } from "../../components/Select";
import { useI18n } from "../../i18n";
import type { PatternKind, TargetType } from "../../types/ipc";

interface RenamerFilterCardProps {
  targetType: TargetType;
  patternKind: PatternKind;
  recursive: boolean;
  ignoreHidden: boolean;
  extFilterText: string;
  includeText: string;
  excludeText: string;
  onChangeTargetType: (val: TargetType) => void;
  onChangePatternKind: (val: PatternKind) => void;
  onChangeRecursive: (checked: boolean) => void;
  onChangeIgnoreHidden: (checked: boolean) => void;
  onChangeExtFilterText: (val: string) => void;
  onChangeIncludeText: (val: string) => void;
  onChangeExcludeText: (val: string) => void;
}

export const RenamerFilterCard: React.FC<RenamerFilterCardProps> = ({
  targetType,
  patternKind,
  recursive,
  ignoreHidden,
  extFilterText,
  includeText,
  excludeText,
  onChangeTargetType,
  onChangePatternKind,
  onChangeRecursive,
  onChangeIgnoreHidden,
  onChangeExtFilterText,
  onChangeIncludeText,
  onChangeExcludeText,
}) => {
  const { t } = useI18n();

  return (
    <div className="knit-card space-y-3 p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-[#343A40]">
        {t.renamer.layer1Heading}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          ariaLabel="Target type"
          value={targetType}
          onChange={(val) => onChangeTargetType(val as TargetType)}
          className="w-full"
          options={[
            { value: "both", label: t.renamer.targetBoth },
            { value: "files", label: t.renamer.targetFiles },
            { value: "folders", label: t.renamer.targetFolders },
          ]}
        />
        <Select
          ariaLabel="Pattern kind"
          value={patternKind}
          onChange={(val) => onChangePatternKind(val as PatternKind)}
          className="w-full"
          options={[
            { value: "glob", label: t.renamer.patternGlob },
            { value: "regex", label: t.renamer.patternRegex },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => onChangeRecursive(e.target.checked)}
          />
          {t.renamer.recursiveLabel}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ignoreHidden}
            onChange={(e) => onChangeIgnoreHidden(e.target.checked)}
          />
          {t.renamer.ignoreHiddenLabel}
        </label>
      </div>
      <input
        type="text"
        placeholder={t.renamer.extensionsPlaceholder}
        value={extFilterText}
        onChange={(e) => onChangeExtFilterText(e.target.value)}
        className="knit-control knit-input w-full px-2.5 font-mono-code text-xs"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder={t.renamer.includePlaceholder}
          value={includeText}
          onChange={(e) => onChangeIncludeText(e.target.value)}
          className="knit-control knit-input w-full px-2.5 font-mono-code text-xs"
        />
        <input
          type="text"
          placeholder={t.renamer.excludePlaceholder}
          value={excludeText}
          onChange={(e) => onChangeExcludeText(e.target.value)}
          className="knit-control knit-input w-full px-2.5 font-mono-code text-xs"
        />
      </div>
    </div>
  );
};
