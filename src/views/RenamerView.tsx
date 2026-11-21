import React from "react";
import { AlertTriangle, Folder, Play, RotateCcw, SearchX, Trash2 } from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { ViewHeader } from "../components/ViewHeader";
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
import { RenamerFilterCard } from "./renamer/RenamerFilterCard";
import { RenamerPreviewTable } from "./renamer/RenamerPreviewTable";
import { RenamerRuleCard } from "./renamer/RenamerRuleCard";

interface RenamerViewProps {
  onStartJob: (jobId: string, label: string, outputPaths?: string[]) => void;
  onJobEvent: (ev: JobEvent, jobId?: string) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
    heading?: string,
    jobId?: string,
  ) => void;
  busy: boolean;
  droppedBatch?: DroppedBatch | null;
}

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
    void listRenamePresets().then(setPresets).catch(() => {});
    void hasRenameUndo().then(setUndoReady).catch(() => {});
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
      setPlan(await recomputeRenameCollisions(next));
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
      setPlan(await recomputeRenameCollisions(next));
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const treeRoots = React.useMemo(
    () => buildRenamerTree(plan.items, roots, sortField, sortDir),
    [plan.items, roots, sortField, sortDir],
  );

  const sortedFlatItems = React.useMemo(
    () => (viewMode === "flat" ? sortFlatRenameItems(plan.items, sortField, sortDir) : []),
    [viewMode, plan.items, sortField, sortDir],
  );

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

  const selectedPending = plan.items.filter((i) => i.selected && i.status === "pending").length;
  const conflicts = plan.items.filter((i) => i.selected && i.status === "conflict").length;

  const handleApply = async () => {
    if (selectedPending === 0 || conflicts > 0 || busy) return;
    setErrorMsg(null);
    const jobId = crypto.randomUUID();
    try {
      onStartJob(jobId, t.shell.nav.renamer.label);
      const res = await applyBatchRename(jobId, plan, (ev) => onJobEvent(ev, jobId));
      setUndoReady(res.undo_available);
      onFinishJob(
        t.shell.nav.renamer.label,
        roots,
        t.renamer.doneSummary(res.renamed_count, res.skipped_count, res.error_count),
        res.error_count > 0 ? "error" : "success",
        t.renamer.renameSuccessTitle,
        jobId,
      );
      await refreshPreview(roots);
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.shell.nav.renamer.label, [], msg, "error", undefined, jobId);
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
      <ViewHeader
        title={t.renamer.title}
        subtitle={t.renamer.subtitle}
        actions={
          <>
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
              className="knit-btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {t.renamer.applyBtn(selectedPending)}
            </button>
          </>
        }
      />

      <ErrorBanner message={errorMsg} />

      <ErrorBanner
        message={conflicts > 0 ? t.renamer.conflictBanner(conflicts) : null}
        icon={<AlertTriangle className="h-4 w-4 shrink-0" />}
      />

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <RenamerFilterCard
          targetType={targetType}
          patternKind={patternKind}
          recursive={recursive}
          ignoreHidden={ignoreHidden}
          extFilterText={extFilterText}
          includeText={includeText}
          excludeText={excludeText}
          onChangeTargetType={setTargetType}
          onChangePatternKind={setPatternKind}
          onChangeRecursive={setRecursive}
          onChangeIgnoreHidden={setIgnoreHidden}
          onChangeExtFilterText={setExtFilterText}
          onChangeIncludeText={setIncludeText}
          onChangeExcludeText={setExcludeText}
        />

        <RenamerRuleCard
          ruleMode={ruleMode}
          findStr={findStr}
          replaceStr={replaceStr}
          matchCase={matchCase}
          useRegex={useRegex}
          perlExpr={perlExpr}
          fixedPreset={fixedPreset}
          presets={presets}
          newPresetTitle={newPresetTitle}
          onChangeRuleMode={setRuleMode}
          onChangeFindStr={setFindStr}
          onChangeReplaceStr={setReplaceStr}
          onChangeMatchCase={setMatchCase}
          onChangeUseRegex={setUseRegex}
          onChangePerlExpr={setPerlExpr}
          onChangeFixedPreset={setFixedPreset}
          onChangeNewPresetTitle={setNewPresetTitle}
          onSavePreset={() => void handleSavePreset()}
          onApplyPreset={applyPreset}
          onDeletePreset={(id) => void deleteRenamePreset(id).then(setPresets)}
        />
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
        <div className="knit-card flex flex-col items-center justify-center px-6 py-10 text-center">
          <SearchX className="h-8 w-8 text-[#6C757D]" />
          <div className="mt-2.5 text-base font-bold text-[#343A40]">
            {t.renamer.emptyMatchTitle}
          </div>
          <p className="mt-1 max-w-xl text-sm text-[#6C757D]">{t.renamer.emptyMatchDesc}</p>
        </div>
      )}

      <RenamerPreviewTable
        items={plan.items}
        selectedPending={selectedPending}
        viewMode={viewMode}
        livePreviewHeightPx={livePreviewHeightPx}
        scrollTop={scrollTop}
        scrollContainerRef={scrollContainerRef}
        visibleTreeRows={visibleTreeRows}
        sortedFlatItems={sortedFlatItems}
        sortField={sortField}
        sortDir={sortDir}
        onChangeViewMode={setViewMode}
        onExpandAll={expandAllFolders}
        onCollapseAll={() => setExpandedKeys(new Set())}
        onToggleAllSelected={(sel) => void toggleAllSelected(sel)}
        onToggleItemSelected={(idx, sel) => void applySelectionIndices([idx], sel)}
        onApplySelectionIndices={(indices, sel) => void applySelectionIndices(indices, sel)}
        onToggleFolderExpanded={toggleFolderExpanded}
        onClearRoots={() => setRoots([])}
        onScrollTopChange={setScrollTop}
        onToggleSort={handleToggleSort}
        onPreviewResizeStart={handlePreviewResizeStart}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
