import React from "react";
import { Select } from "../components/Select";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bookmark,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderKanban,
  FolderOpen,
  GripHorizontal,
  List,
  ListTree,
  Play,
  RotateCcw,
  SearchX,
  Trash2,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { useVerticalResize } from "../hooks/useVerticalResize";
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
import {
  buildRenamerTree,
  flattenVisibleTree,
  sortFlatRenameItems,
  type RenamerSortDir,
  type RenamerSortField,
} from "../lib/renamerTree";
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
    heading?: string,
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
  const { toast: importToast, highlighted: importHighlighted, notifyImported } =
    useImportFeedback();

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
  const [scanningFolder, setScanningFolder] = React.useState(false);
  const [viewMode, setViewMode] = usePersistentState<"tree" | "flat">(
    "knit.renamer.viewMode",
    "tree",
  );
  const [previewHeightPx, setPreviewHeightPx] = usePersistentState<number>(
    "knit.renamer.previewHeightPx",
    384,
  );
  const { height: livePreviewHeightPx, handlePointerDown: handlePreviewResizeStart } =
    useVerticalResize({
      value: previewHeightPx,
      min: 180,
      max: 900,
      onCommit: setPreviewHeightPx,
    });
  const [expandedKeys, setExpandedKeys] = React.useState<Set<string>>(() => new Set());
  const [scrollTop, setScrollTop] = React.useState(0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);
  const previewSeqRef = React.useRef<number>(0);
  const itemCountRef = React.useRef<number>(0);
  const prevRootsKeyRef = React.useRef<string>("");
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    itemCountRef.current = plan.items.length;
  }, [plan.items.length]);

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
      notifyImported(t.common.importSuccessToast(`${droppedBatch.paths.length}`));
    }
  }, [droppedBatch, notifyImported, t.common]);

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
    async (targetRoots = roots, showLoading = false) => {
      const seq = ++previewSeqRef.current;
      if (targetRoots.length === 0) {
        setPlan({ items: [] });
        setScanningFolder(false);
        return;
      }
      setErrorMsg(null);
      if (showLoading) setScanningFolder(true);
      try {
        const nextPlan = await previewBatchRename(targetRoots, buildFilter(), buildRule());
        if (previewSeqRef.current !== seq) return;
        setPlan(nextPlan);
      } catch (e) {
        if (previewSeqRef.current !== seq) return;
        setErrorMsg(String(e));
      } finally {
        if (showLoading && previewSeqRef.current === seq) {
          setScanningFolder(false);
        }
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
    const rootsKey = roots.join("\0");
    const rootsChanged = rootsKey !== prevRootsKeyRef.current;
    prevRootsKeyRef.current = rootsKey;

    if (roots.length === 0) {
      previewSeqRef.current += 1;
      setPlan({ items: [] });
      setExpandedKeys(new Set());
      setScanningFolder(false);
      return;
    }

    if (rootsChanged) {
      setExpandedKeys(new Set());
      setScrollTop(0);
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
      void refreshPreview(roots, true);
      return;
    }

    // Adaptive debounce: instant for <= 500 items, 150ms debounce for > 500 items
    if (itemCountRef.current <= 500) {
      void refreshPreview(roots, false);
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPreview(roots, false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [roots, refreshPreview]);

  const [sortField, setSortField] = React.useState<RenamerSortField>("none");
  const [sortDir, setSortDir] = React.useState<RenamerSortDir>("asc");

  const handleToggleSort = (field: Exclude<RenamerSortField, "none">) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortField("none");
      setSortDir("asc");
    }
  };

  const handleAddRoot = async () => {
    const dir = await pickDirectory(t.renamer.pickDirDialog);
    if (!dir) return;
    setRoots((prev) => Array.from(new Set([...prev, dir])));
    notifyImported(t.common.importSuccessToast(dir.split(/[\\/]/).pop() ?? dir));
  };

  const applySelectionIndices = async (indices: number[], selected: boolean) => {
    if (indices.length === 0) return;
    const indexSet = new Set(indices);
    const next: RenamePlan = {
      items: plan.items.map((it, i) => (indexSet.has(i) ? { ...it, selected } : it)),
    };
    setPlan(next);
    try {
      const checked = await recomputeRenameCollisions(next);
      setPlan(checked);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const toggleItemSelected = async (idx: number, selected: boolean) => {
    await applySelectionIndices([idx], selected);
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

  const treeRoots = React.useMemo(
    () => buildRenamerTree(plan.items, roots, sortField, sortDir),
    [plan.items, roots, sortField, sortDir],
  );

  const sortedFlatItems = React.useMemo(
    () =>
      viewMode === "flat"
        ? sortFlatRenameItems(plan.items, sortField, sortDir)
        : [],
    [viewMode, plan.items, sortField, sortDir],
  );

  // Auto-expand small trees on initial scan so small folders are immediately visible
  React.useEffect(() => {
    if (plan.items.length > 0 && plan.items.length <= 200) {
      setExpandedKeys((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        const collect = (nodes: typeof treeRoots) => {
          for (const n of nodes) {
            if (n.children.length > 0) {
              next.add(n.key);
              collect(n.children);
            }
          }
        };
        collect(treeRoots);
        return next;
      });
    }
  }, [plan.items.length, treeRoots]);

  const visibleTreeRows = React.useMemo(
    () => (viewMode === "tree" ? flattenVisibleTree(treeRoots, plan.items, expandedKeys) : []),
    [viewMode, treeRoots, plan.items, expandedKeys],
  );

  const toggleFolderExpanded = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAllFolders = () => {
    const next = new Set<string>();
    const collect = (nodes: typeof treeRoots) => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          next.add(n.key);
          collect(n.children);
        }
      }
    };
    collect(treeRoots);
    setExpandedKeys(next);
  };

  const collapseAllFolders = () => {
    setExpandedKeys(new Set());
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
        t.renamer.renameSuccessTitle,
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
        t.renamer.undoSuccessTitle,
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
            <Select
              ariaLabel="Target type"
              value={targetType}
              onChange={(val) => setTargetType(val as TargetType)}
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
              onChange={(val) => setPatternKind(val as PatternKind)}
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
            <Select
              ariaLabel="Fixed preset"
              value={fixedPreset}
              onChange={(val) => setFixedPreset(val as FixedPresetKind)}
              className="w-full"
              options={FIXED_PRESET_KEYS.map((key) => ({
                value: key,
                label: t.renamer.fixedPresets[key],
              }))}
            />
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
        loading={scanningFolder}
      />

      {roots.length > 0 && (
        <div
          className={`space-y-2 rounded-[4px] border p-3.5 transition-colors duration-300 ${
            importHighlighted
              ? "border-[#28A745] bg-[#D4EDDA]/45"
              : "border-[#DEE2E6] bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#343A40]">
              {t.renamer.scannedFoldersHeading(roots.length)}
            </span>
            <button
              type="button"
              onClick={() => setRoots([])}
              className="text-xs font-semibold text-[#DC3545] hover:underline"
            >
              {t.renamer.clearFoldersBtn}
            </button>
          </div>
          {roots.map((r) => (
            <div
              key={r}
              className={`flex items-center justify-between gap-2 rounded-[4px] border px-3 py-2 text-xs transition-colors duration-300 ${
                importHighlighted
                  ? "border-[#A3CFBB] bg-[#E9F7EF]"
                  : "border-[#E9ECEF] bg-[#F8F9FA]"
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Folder className="h-3.5 w-3.5 shrink-0 text-[#F59E0B]" />
                <span className="font-mono-code truncate text-[#212529]" title={r}>
                  {r}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRoots((prev) => prev.filter((item) => item !== r))}
                title={t.renamer.removeFolderBtnTitle}
                className="shrink-0 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {roots.length > 0 && !scanningFolder && plan.items.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-[4px] border border-[#DEE2E6] bg-white px-6 py-10 text-center">
          <SearchX className="h-8 w-8 text-[#6C757D]" />
          <div className="mt-2.5 text-base font-bold text-[#343A40]">
            {t.renamer.emptyMatchTitle}
          </div>
          <p className="mt-1 max-w-xl text-sm text-[#6C757D]">
            {t.renamer.emptyMatchDesc}
          </p>
        </div>
      )}

      {/* Layer 2: Dry-Run Preview Table */}
      {plan.items.length > 0 && (() => {
        const selectedCount = plan.items.filter((i) => i.selected).length;
        const allSelected = selectedCount === plan.items.length;
        const someSelected = selectedCount > 0 && selectedCount < plan.items.length;

        const ROW_HEIGHT = 38;
        const totalRows = viewMode === "tree" ? visibleTreeRows.length : sortedFlatItems.length;
        const overscan = 8;
        const visibleCount = Math.ceil(livePreviewHeightPx / ROW_HEIGHT) + overscan * 2;
        const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
        const endIdx = Math.min(totalRows, startIdx + visibleCount);
        const topPadPx = startIdx * ROW_HEIGHT;
        const bottomPadPx = Math.max(0, (totalRows - endIdx) * ROW_HEIGHT);

        const renderSortIcon = (field: Exclude<RenamerSortField, "none">) => {
          if (sortField !== field) {
            return <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />;
          }
          return sortDir === "asc" ? (
            <ArrowUp className="h-3.5 w-3.5 text-[#007BFF]" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5 text-[#007BFF]" />
          );
        };

        return (
          <div className="space-y-1.5">
            <div className="overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2.5 text-sm">
                <div className="flex items-center gap-2 font-semibold text-[#343A40]">
                  <FolderKanban className="h-4 w-4 text-[#007BFF]" />
                  {t.renamer.previewHeading(plan.items.length, selectedPending)}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="inline-flex overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white">
                    <button
                      type="button"
                      onClick={() => setViewMode("tree")}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold ${
                        viewMode === "tree"
                          ? "bg-[#007BFF] text-white"
                          : "text-[#343A40] hover:bg-[#E9ECEF]"
                      }`}
                    >
                      <ListTree className="h-3.5 w-3.5" />
                      {t.renamer.viewTreeBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("flat")}
                      className={`inline-flex items-center gap-1 border-l border-[#CED4DA] px-2.5 py-1 text-xs font-semibold ${
                        viewMode === "flat"
                          ? "bg-[#007BFF] text-white"
                          : "text-[#343A40] hover:bg-[#E9ECEF]"
                      }`}
                    >
                      <List className="h-3.5 w-3.5" />
                      {t.renamer.viewFlatBtn}
                    </button>
                  </div>
                  {viewMode === "tree" && (
                    <>
                      <button
                        type="button"
                        onClick={expandAllFolders}
                        className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs hover:bg-[#E9ECEF]"
                      >
                        {t.renamer.expandAllBtn}
                      </button>
                      <button
                        type="button"
                        onClick={collapseAllFolders}
                        className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs hover:bg-[#E9ECEF]"
                      >
                        {t.renamer.collapseAllBtn}
                      </button>
                    </>
                  )}
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

              <div
                ref={scrollContainerRef}
                onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                style={{ height: `${livePreviewHeightPx}px` }}
                className="overflow-auto"
              >
                <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
                  <colgroup>
                    <col className="w-24" />
                    <col className="w-20" />
                    <col className="w-[34%]" />
                    <col className="w-[34%]" />
                    <col className="w-28" />
                  </colgroup>
                  <thead className="text-xs uppercase text-[#6C757D]">
                    <tr>
                      <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                        <label className="inline-flex cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            aria-label={t.renamer.selectAllBtn}
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = someSelected;
                            }}
                            onChange={(e) => void toggleAllSelected(e.target.checked)}
                          />
                          <span>{t.renamer.colSelect}</span>
                        </label>
                      </th>
                      <th className="sticky top-0 z-20 bg-[#F8F9FA] px-2 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("type")}
                          className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                        >
                          <span>{t.renamer.colType}</span>
                          {renderSortIcon("type")}
                        </button>
                      </th>
                      <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("original")}
                          className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                        >
                          <span>{t.renamer.colOriginal}</span>
                          {renderSortIcon("original")}
                        </button>
                      </th>
                      <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("new")}
                          className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                        >
                          <span>{t.renamer.colNew}</span>
                          {renderSortIcon("new")}
                        </button>
                      </th>
                      <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("status")}
                          className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                        >
                          <span>{t.renamer.colStatus}</span>
                          {renderSortIcon("status")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E9ECEF]">
                    {topPadPx > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={5} style={{ height: `${topPadPx}px`, padding: 0 }} />
                      </tr>
                    )}

                    {viewMode === "tree"
                      ? visibleTreeRows.slice(startIdx, endIdx).map((row) => {
                          const { node, treeDepth, hasChildren, isExpanded } = row;
                          const item = node.item;
                          const isChecked = item ? item.selected : row.allSelected;
                          const isIndeterminate = node.isDir && row.someSelected;
                          const status = item?.status ?? null;

                          return (
                            <tr
                              key={row.key}
                              style={{ height: `${ROW_HEIGHT}px` }}
                              className={
                                isChecked || row.someSelected
                                  ? "bg-white"
                                  : "bg-[#F8F9FA] opacity-60"
                              }
                            >
                              <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  ref={(el) => {
                                    if (el) el.indeterminate = isIndeterminate;
                                  }}
                                  onChange={(e) => {
                                    if (node.isDir) {
                                      void applySelectionIndices(
                                        node.subtreePlanIndices,
                                        e.target.checked,
                                      );
                                    } else if (node.planIndex !== null) {
                                      void toggleItemSelected(node.planIndex, e.target.checked);
                                    }
                                  }}
                                />
                              </td>
                              <td className="border-b border-[#E9ECEF] px-2 py-1.5 text-xs font-medium text-[#6C757D]">
                                {node.isDir ? "DIR" : "FILE"}
                              </td>
                              <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 text-[#495057]">
                                <div
                                  className="flex min-w-0 items-center gap-1"
                                  style={{ paddingLeft: `${treeDepth * 16}px` }}
                                >
                                  {hasChildren ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleFolderExpanded(row.key)}
                                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#6C757D] hover:bg-[#E9ECEF]"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="inline-block w-4 shrink-0" />
                                  )}
                                  {node.isDir &&
                                    (isExpanded ? (
                                      <FolderOpen className="h-4 w-4 shrink-0 text-[#007BFF]" />
                                    ) : (
                                      <Folder className="h-4 w-4 shrink-0 text-[#F59E0B]" />
                                    ))}
                                  <span className="truncate" title={item?.original_path ?? row.key}>
                                    {node.name}
                                  </span>
                                </div>
                              </td>
                              <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 font-semibold text-[#212529]">
                                <span
                                  className="block truncate"
                                  title={item ? item.new_name : node.name}
                                >
                                  {item ? item.new_name : node.name}
                                </span>
                              </td>
                              <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                                {status && (
                                  <span
                                    className={`inline-block rounded-[4px] px-1.5 py-0.5 text-xs font-semibold uppercase ${
                                      status === "conflict"
                                        ? "bg-[#F8D7DA] text-[#721C24]"
                                        : status === "pending"
                                          ? "bg-[#D1ECF1] text-[#0C5460]"
                                          : "bg-[#E9ECEF] text-[#6C757D]"
                                    }`}
                                    title={item?.error_message || undefined}
                                  >
                                    {status}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      : sortedFlatItems.slice(startIdx, endIdx).map(({ item, planIndex }) => (
                          <tr
                            key={item.id}
                            style={{ height: `${ROW_HEIGHT}px` }}
                            className={item.selected ? "bg-white" : "bg-[#F8F9FA] opacity-60"}
                          >
                            <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={item.selected}
                                onChange={(e) => void toggleItemSelected(planIndex, e.target.checked)}
                              />
                            </td>
                            <td className="border-b border-[#E9ECEF] px-2 py-1.5 text-xs font-medium text-[#6C757D]">
                              {item.is_dir ? "DIR" : "FILE"}
                            </td>
                            <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 text-[#495057]">
                              <span className="block truncate" title={item.original_path}>
                                {item.original_name}
                              </span>
                            </td>
                            <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 font-semibold text-[#212529]">
                              <span className="block truncate" title={item.new_name}>
                                {item.new_name}
                              </span>
                            </td>
                            <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                              <span
                                className={`inline-block rounded-[4px] px-1.5 py-0.5 text-xs font-semibold uppercase ${
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

                    {bottomPadPx > 0 && (
                      <tr aria-hidden="true">
                        <td colSpan={5} style={{ height: `${bottomPadPx}px`, padding: 0 }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize rename preview height"
              onPointerDown={handlePreviewResizeStart}
              title={`${livePreviewHeightPx}px`}
              className="flex h-4 cursor-ns-resize select-none items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] text-[#6C757D] hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]"
            >
              <GripHorizontal className="h-3.5 w-3.5" />
              <span className="ml-2 font-mono-code text-[11px]">{livePreviewHeightPx}px</span>
            </div>
          </div>
        );
      })()}

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
