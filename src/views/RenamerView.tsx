import React from "react";
import {
  AlertTriangle,
  Bookmark,
  CheckSquare,
  FolderKanban,
  Play,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { useI18n } from "../i18n";
import {
  applyBatchRename,
  deleteRenamePreset,
  hasRenameUndo,
  listRenamePresets,
  pickDirectory,
  previewBatchRename,
  recomputeRenameCollisions,
  saveRenamePreset,
  undoLastRename,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
  FilterPattern,
  FixedPresetKind,
  JobEvent,
  PatternKind,
  RenamePlan,
  RenameRule,
  ScanFilter,
  TargetType,
  UserPreset,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

interface RenamerViewProps {
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

export const RenamerView: React.FC<RenamerViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [roots, setRoots] = React.useState<string[]>([]);
  const [targetType, setTargetType] = usePersistentState<TargetType>(
    "knit.renamer.targetType",
    "both",
  );
  const [recursive, setRecursive] = usePersistentState<boolean>("knit.renamer.recursive", true);
  const [ignoreHidden, setIgnoreHidden] = usePersistentState<boolean>(
    "knit.renamer.ignoreHidden",
    true,
  );
  const [extFilterText, setExtFilterText] = usePersistentState<string>("knit.renamer.extFilter", "");
  const [includeText, setIncludeText] = usePersistentState<string>("knit.renamer.includeText", "");
  const [excludeText, setExcludeText] = usePersistentState<string>("knit.renamer.excludeText", "");
  const [patternKind, setPatternKind] = usePersistentState<PatternKind>(
    "knit.renamer.patternKind",
    "glob",
  );

  const [ruleMode, setRuleMode] = usePersistentState<
    "find_replace" | "perl_prename" | "fixed_preset"
  >("knit.renamer.ruleMode", "find_replace");
  const [findStr, setFindStr] = usePersistentState<string>("knit.renamer.findStr", "");
  const [replaceStr, setReplaceStr] = usePersistentState<string>("knit.renamer.replaceStr", "");
  const [matchCase, setMatchCase] = usePersistentState<boolean>("knit.renamer.matchCase", false);
  const [useRegex, setUseRegex] = usePersistentState<boolean>("knit.renamer.useRegex", false);
  const [perlExpr, setPerlExpr] = usePersistentState<string>("knit.renamer.perlExpr", "s/\\s+/_/g");
  const [fixedPreset, setFixedPreset] = usePersistentState<FixedPresetKind>(
    "knit.renamer.fixedPreset",
    "clean_whitespace",
  );

  const [plan, setPlan] = React.useState<RenamePlan>({ items: [] });
  const [presets, setPresets] = React.useState<UserPreset[]>([]);
  const [newPresetTitle, setNewPresetTitle] = React.useState("");
  const [undoReady, setUndoReady] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  React.useEffect(() => {
    void listRenamePresets()
      .then(setPresets)
      .catch(() => {});
    void hasRenameUndo()
      .then(setUndoReady)
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    if (droppedBatch.paths.length > 0) {
      setRoots((prev) => Array.from(new Set([...prev, ...droppedBatch.paths])));
    }
  }, [droppedBatch]);

  const buildFilter = (): ScanFilter => {
    const parsePatterns = (raw: string): FilterPattern[] =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pattern) => ({ kind: patternKind, pattern }));

    return {
      target_type: targetType,
      recursive,
      max_depth: null,
      ignore_hidden: ignoreHidden,
      include_extensions: extFilterText
        .split(",")
        .map((s) => s.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean),
      include_patterns: parsePatterns(includeText),
      exclude_patterns: parsePatterns(excludeText),
    };
  };

  const buildRule = (): RenameRule => {
    if (ruleMode === "find_replace") {
      return {
        mode: "find_replace",
        find: findStr,
        replace: replaceStr,
        match_case: matchCase,
        use_regex: useRegex,
      };
    }
    if (ruleMode === "perl_prename") {
      return { mode: "perl_prename", expression: perlExpr };
    }
    return { mode: "fixed_preset", preset: fixedPreset };
  };

  const refreshPreview = React.useCallback(
    async (targetRoots = roots) => {
      if (targetRoots.length === 0) {
        setPlan({ items: [] });
        return;
      }
      setErrorMsg(null);
      try {
        const nextPlan = await previewBatchRename(targetRoots, buildFilter(), buildRule());
        setPlan(nextPlan);
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      roots,
      targetType,
      recursive,
      ignoreHidden,
      extFilterText,
      includeText,
      excludeText,
      patternKind,
      ruleMode,
      findStr,
      replaceStr,
      matchCase,
      useRegex,
      perlExpr,
      fixedPreset,
    ],
  );

  React.useEffect(() => {
    if (roots.length > 0) {
      void refreshPreview(roots);
    } else {
      setPlan({ items: [] });
    }
  }, [roots, refreshPreview]);

  const handleAddRoot = async () => {
    const dir = await pickDirectory(t.renamer.pickDirDialog);
    if (!dir) return;
    setRoots((prev) => Array.from(new Set([...prev, dir])));
  };

  const toggleItemSelected = async (idx: number, selected: boolean) => {
    const next: RenamePlan = {
      items: plan.items.map((it, i) => (i === idx ? { ...it, selected } : it)),
    };
    setPlan(next);
    try {
      const checked = await recomputeRenameCollisions(next);
      setPlan(checked);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const toggleAllSelected = async (selected: boolean) => {
    const next: RenamePlan = {
      items: plan.items.map((it) => ({ ...it, selected })),
    };
    setPlan(next);
    try {
      const checked = await recomputeRenameCollisions(next);
      setPlan(checked);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const selectedPending = plan.items.filter((i) => i.selected && i.status === "pending").length;
  const conflicts = plan.items.filter((i) => i.selected && i.status === "conflict").length;

  const handleApply = async () => {
    if (selectedPending === 0 || conflicts > 0 || busy) return;
    setErrorMsg(null);
    try {
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.renamer.label);
      const res = await applyBatchRename(jobId, plan, onJobEvent);
      setUndoReady(res.undo_available);
      onFinishJob(
        t.shell.nav.renamer.label,
        roots,
        t.renamer.doneSummary(res.renamed_count, res.skipped_count, res.error_count),
        res.error_count > 0 ? "error" : "success",
      );
      await refreshPreview(roots);
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.shell.nav.renamer.label, [], msg, "error");
    }
  };

  const handleUndo = async () => {
    if (!undoReady || busy) return;
    setErrorMsg(null);
    try {
      const res = await undoLastRename();
      setUndoReady(false);
      onFinishJob(
        t.renamer.undoBtn,
        roots,
        t.renamer.undoSummary(res.renamed_count, res.error_count),
        "success",
      );
      await refreshPreview(roots);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleSavePreset = async () => {
    const title = newPresetTitle.trim();
    if (!title) return;
    const saved = await saveRenamePreset({
      id: crypto.randomUUID(),
      title,
      description: ruleMode,
      rule: buildRule(),
    });
    setPresets(saved);
    setNewPresetTitle("");
  };

  const applyPreset = (p: UserPreset) => {
    if (p.rule.mode === "find_replace") {
      setRuleMode("find_replace");
      setFindStr(p.rule.find);
      setReplaceStr(p.rule.replace);
      setMatchCase(p.rule.match_case);
      setUseRegex(p.rule.use_regex);
    } else if (p.rule.mode === "perl_prename") {
      setRuleMode("perl_prename");
      setPerlExpr(p.rule.expression);
    } else {
      setRuleMode("fixed_preset");
      setFixedPreset(p.rule.preset);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.renamer.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.renamer.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!undoReady || busy}
            onClick={() => void handleUndo()}
            className="flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-3.5 py-2 text-sm font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
          >
            <RotateCcw className="h-4 w-4" />
            {t.renamer.undoBtn}
          </button>
          <button
            type="button"
            disabled={selectedPending === 0 || conflicts > 0 || busy}
            onClick={() => void handleApply()}
            className="flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {t.renamer.applyBtn(selectedPending)}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      {conflicts > 0 && (
        <div className="flex items-center gap-2 rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t.renamer.conflictBanner(conflicts)}
        </div>
      )}

      {/* Layer 1: Filter Bar + Rule Builder */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <div className="space-y-3 rounded-[4px] border border-[#DEE2E6] bg-white p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-[#343A40]">
            {t.renamer.layer1Heading}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as TargetType)}
              className="knit-control rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
            >
              <option value="both">{t.renamer.targetBoth}</option>
              <option value="files">{t.renamer.targetFiles}</option>
              <option value="folders">{t.renamer.targetFolders}</option>
            </select>
            <select
              value={patternKind}
              onChange={(e) => setPatternKind(e.target.value as PatternKind)}
              className="knit-control rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
            >
              <option value="glob">{t.renamer.patternGlob}</option>
              <option value="regex">{t.renamer.patternRegex}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={recursive}
                onChange={(e) => setRecursive(e.target.checked)}
              />
              {t.renamer.recursiveLabel}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={ignoreHidden}
                onChange={(e) => setIgnoreHidden(e.target.checked)}
              />
              {t.renamer.ignoreHiddenLabel}
            </label>
          </div>
          <input
            type="text"
            placeholder={t.renamer.extensionsPlaceholder}
            value={extFilterText}
            onChange={(e) => setExtFilterText(e.target.value)}
            className="knit-control w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t.renamer.includePlaceholder}
              value={includeText}
              onChange={(e) => setIncludeText(e.target.value)}
              className="knit-control w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
            />
            <input
              type="text"
              placeholder={t.renamer.excludePlaceholder}
              value={excludeText}
              onChange={(e) => setExcludeText(e.target.value)}
              className="knit-control w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-[4px] border border-[#DEE2E6] bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide text-[#343A40]">
              {t.renamer.ruleHeading}
            </span>
            <div className="flex gap-1">
              {(["find_replace", "perl_prename", "fixed_preset"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRuleMode(m)}
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
                  onChange={(e) => setFindStr(e.target.value)}
                  className="knit-control rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
                <input
                  type="text"
                  placeholder={t.renamer.replacePlaceholder}
                  value={replaceStr}
                  onChange={(e) => setReplaceStr(e.target.value)}
                  className="knit-control rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={matchCase}
                    onChange={(e) => setMatchCase(e.target.checked)}
                  />
                  {t.renamer.matchCaseLabel}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useRegex}
                    onChange={(e) => setUseRegex(e.target.checked)}
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
                onChange={(e) => setPerlExpr(e.target.value)}
                placeholder={t.renamer.prenamePlaceholder}
                className="knit-control w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
              />
              <div className="mt-1.5 text-xs text-[#6C757D]">{t.renamer.prenameHint}</div>
            </div>
          )}

          {ruleMode === "fixed_preset" && (
            <select
              value={fixedPreset}
              onChange={(e) => setFixedPreset(e.target.value as FixedPresetKind)}
              className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
            >
              {FIXED_PRESET_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t.renamer.fixedPresets[key]}
                </option>
              ))}
            </select>
          )}

          {/* User Presets */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[#E9ECEF] pt-2.5">
            <Bookmark className="h-4 w-4 text-[#6C757D]" />
            <input
              type="text"
              placeholder={t.renamer.savePresetPlaceholder}
              value={newPresetTitle}
              onChange={(e) => setNewPresetTitle(e.target.value)}
              className="knit-control-sm w-40 rounded-[4px] border border-[#CED4DA] px-2.5 text-xs"
            />
            <button
              type="button"
              onClick={() => void handleSavePreset()}
              className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-3 text-xs font-semibold hover:bg-[#E9ECEF]"
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
                  onClick={() => applyPreset(p)}
                  className="font-semibold text-[#007BFF] hover:underline"
                >
                  {p.title}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRenamePreset(p.id).then(setPresets)}
                  className="text-[#DC3545]"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      <Dropzone
        title={t.renamer.dropTitle}
        description={
          roots.length > 0 ? t.renamer.dropDescScanning(roots.join(", ")) : t.renamer.dropDescIdle
        }
        onPickFolder={() => void handleAddRoot()}
        folderLabel={roots.length > 0 ? t.renamer.addFolderBtn : t.renamer.pickFolderBtn}
      />

      {/* Layer 2: Dry-Run Preview Table */}
      {plan.items.length > 0 && (
        <div className="overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2.5 text-sm">
            <div className="flex items-center gap-2 font-semibold text-[#343A40]">
              <FolderKanban className="h-4 w-4 text-[#007BFF]" />
              {t.renamer.previewHeading(plan.items.length, selectedPending)}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void toggleAllSelected(true)}
                className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs hover:bg-[#E9ECEF]"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {t.renamer.selectAllBtn}
              </button>
              <button
                type="button"
                onClick={() => void toggleAllSelected(false)}
                className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs hover:bg-[#E9ECEF]"
              >
                {t.renamer.deselectAllBtn}
              </button>
              <button
                type="button"
                onClick={() => setRoots([])}
                className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                {t.renamer.clearFoldersBtn}
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 border-b border-[#DEE2E6] bg-[#F8F9FA] text-xs uppercase text-[#6C757D]">
                <tr>
                  <th className="w-10 px-3 py-2">{t.renamer.colSelect}</th>
                  <th className="w-16 px-2 py-2">{t.renamer.colType}</th>
                  <th className="px-3 py-2">{t.renamer.colOriginal}</th>
                  <th className="px-3 py-2">{t.renamer.colNew}</th>
                  <th className="w-28 px-3 py-2">{t.renamer.colStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E9ECEF]">
                {plan.items.map((item, idx) => (
                  <tr
                    key={item.id}
                    className={item.selected ? "bg-white" : "bg-[#F8F9FA] opacity-60"}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => void toggleItemSelected(idx, e.target.checked)}
                      />
                    </td>
                    <td className="px-2 py-2 font-mono-code text-xs text-[#6C757D]">
                      {item.is_dir ? "DIR" : "FILE"}
                    </td>
                    <td className="px-3 py-2 font-mono-code break-all text-[#495057]">
                      {item.original_name}
                    </td>
                    <td className="px-3 py-2 font-mono-code break-all font-semibold text-[#212529]">
                      {item.new_name}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                          item.status === "conflict"
                            ? "bg-[#F8D7DA] text-[#721C24]"
                            : item.status === "pending"
                              ? "bg-[#D1ECF1] text-[#0C5460]"
                              : "bg-[#E9ECEF] text-[#6C757D]"
                        }`}
                        title={item.error_message || undefined}
                      >
                        {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
