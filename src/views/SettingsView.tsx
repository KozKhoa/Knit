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
import {
  AlertTriangle as GeminiAlertIcon,
  CheckCircle2 as GeminiCheckIcon,
  KeyRound as GeminiKeyIcon,
  Loader2 as GeminiLoaderIcon,
  ShieldCheck as GeminiShieldIcon,
  Sparkles as GeminiSparklesIcon,
  Trash2 as GeminiTrashIcon,
} from "lucide-react";
import {
  clearGeminiKey,
  DEFAULT_GEMINI_MODELS,
  getGeminiKeyStatus,
  listGeminiModels,
  saveGeminiKey,
  saveGeminiModel,
  testGeminiKey,
} from "../lib/ipc";
import type { GeminiKeyStatus } from "../types/ipc";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
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

const GeminiAssistantSettingsCard: React.FC = () => {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<GeminiKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const [availableModels, setAvailableModels] = React.useState<string[]>(DEFAULT_GEMINI_MODELS);
  const [selectedModel, setSelectedModel] = React.useState("gemini-2.5-flash");
  const [customModelInput, setCustomModelInput] = React.useState("");
  const [fetchingModels, setFetchingModels] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  React.useEffect(() => {
    let active = true;
    void getGeminiKeyStatus()
      .then((res) => {
        if (!active) return;
        setStatus(res);
        if (res.model) {
          setSelectedModel(res.model);
          setAvailableModels((prev) =>
            prev.includes(res.model) ? prev : [res.model, ...prev],
          );
        }
      })
      .catch(() => {
        // Bỏ qua trong môi trường non-Tauri
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    if (!apiKeyInput.trim() || saving || testing) return;
    setSaving(true);
    setFeedback(null);
    try {
      const next = await saveGeminiKey(apiKeyInput.trim());
      setStatus(next);
      setApiKeyInput("");
      setFeedback({ kind: "success", text: t.settings.aiSavedStatus });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSelectModel = async (nextModel: string) => {
    const clean = nextModel.trim();
    if (!clean || saving || testing || fetchingModels) return;
    setSelectedModel(clean);
    setAvailableModels((prev) => (prev.includes(clean) ? prev : [clean, ...prev]));
    setFeedback(null);
    try {
      const next = await saveGeminiModel(clean);
      setStatus(next);
      setSelectedModel(next.model);
      setFeedback({ kind: "success", text: t.settings.aiModelSavedStatus(next.model) });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleFetchModels = async () => {
    if (saving || testing || fetchingModels) return;
    setFetchingModels(true);
    setFeedback(null);
    try {
      const candidate = apiKeyInput.trim() || null;
      const models = await listGeminiModels(candidate);
      if (models.length > 0) {
        setAvailableModels(
          models.includes(selectedModel) ? models : [selectedModel, ...models],
        );
      }
      setFeedback({ kind: "success", text: t.settings.aiModelsFetchedStatus(models.length) });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (saving || testing || fetchingModels) return;
    setTesting(true);
    setFeedback(null);
    try {
      const candidate = apiKeyInput.trim() || null;
      const modelToTest = customModelInput.trim() || selectedModel.trim() || null;
      const res = await testGeminiKey(candidate, modelToTest);
      if (res.model) {
        setSelectedModel(res.model);
        setAvailableModels((prev) =>
          prev.includes(res.model) ? prev : [res.model, ...prev],
        );
      }
      setStatus((prev) => (prev ? { ...prev, model: res.model } : res));
      setFeedback({ kind: "success", text: t.settings.aiTestSuccess(res.model) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ kind: "error", text: t.settings.aiTestError(msg) });
    } finally {
      setTesting(false);
    }
  };

  const handleClear = async () => {
    if (saving || testing || fetchingModels) return;
    setSaving(true);
    setFeedback(null);
    try {
      const next = await clearGeminiKey();
      setStatus(next);
      setApiKeyInput("");
      setFeedback({ kind: "success", text: t.settings.aiClearedStatus });
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const storageText =
    status?.storage_backend === "keychain"
      ? t.settings.aiStorageKeychain
      : status?.storage_backend === "config_file"
        ? t.settings.aiStorageConfig
        : t.settings.aiStorageNone;

  return (
    <div data-testid="settings-gemini-card" className="knit-card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-[#212529]">
            <GeminiSparklesIcon className="h-4 w-4 text-[#007BFF]" />
            {t.settings.aiHeading}
          </h2>
          <p className="mt-0.5 text-xs text-[#6C757D]">{t.settings.aiDesc}</p>
        </div>

        <span
          className={`inline-flex items-center gap-1 rounded-[4px] border px-2.5 py-0.5 text-xs font-semibold ${
            status?.configured
              ? "border-[#C3E6CB] bg-[#D4EDDA] text-[#155724]"
              : "border-[#DEE2E6] bg-[#F8F9FA] text-[#6C757D]"
          }`}
        >
          {status?.configured ? (
            <>
              <GeminiCheckIcon className="h-3.5 w-3.5 shrink-0" />
              {t.settings.aiStatusConfigured(status.masked_key ?? "••••")}
            </>
          ) : (
            t.settings.aiStatusUnconfigured
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <GeminiKeyIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[#6C757D]" />
          <input
            type="password"
            data-testid="settings-gemini-key-input"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={t.settings.aiKeyPlaceholder}
            autoComplete="off"
            className="knit-control-sm w-full rounded-[4px] border border-[#CED4DA] bg-white pr-3 pl-8 text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
          />
        </div>

        <button
          type="button"
          data-testid="settings-gemini-save-btn"
          disabled={!apiKeyInput.trim() || saving || testing}
          onClick={() => void handleSave()}
          className="knit-control-sm knit-btn-primary inline-flex items-center gap-1.5 px-3 text-xs font-semibold disabled:opacity-50"
        >
          {saving ? <GeminiLoaderIcon className="h-3.5 w-3.5 animate-spin" /> : null}
          {saving ? t.settings.aiSaving : t.settings.aiSaveBtn}
        </button>

        <button
          type="button"
          data-testid="settings-gemini-test-btn"
          disabled={(!apiKeyInput.trim() && !status?.configured) || saving || testing}
          onClick={() => void handleTest()}
          className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-xs font-semibold disabled:opacity-50"
        >
          {testing ? <GeminiLoaderIcon className="h-3.5 w-3.5 animate-spin text-[#007BFF]" /> : null}
          {testing ? t.settings.aiTesting : t.settings.aiTestBtn}
        </button>

        {status?.configured && (
          <button
            type="button"
            data-testid="settings-gemini-clear-btn"
            disabled={saving || testing}
            onClick={() => void handleClear()}
            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#DC3545] hover:bg-[#FFF5F5] disabled:opacity-50"
          >
            <GeminiTrashIcon className="h-3.5 w-3.5" />
            {t.settings.aiClearBtn}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[#495057]">{t.settings.aiModelLabel}</span>
        <Select
          dataTestId="settings-gemini-model-select"
          ariaLabel={t.settings.aiModelLabel}
          size="sm"
          value={selectedModel}
          disabled={saving || testing || fetchingModels}
          options={availableModels.map((m) => ({ value: m, label: m }))}
          onChange={(val) => void handleSelectModel(val)}
          className="min-w-[220px]"
        />
        <button
          type="button"
          data-testid="settings-gemini-fetch-models-btn"
          disabled={(!apiKeyInput.trim() && !status?.configured) || saving || testing || fetchingModels}
          onClick={() => void handleFetchModels()}
          className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-xs font-semibold disabled:opacity-50"
        >
          {fetchingModels ? (
            <GeminiLoaderIcon className="h-3.5 w-3.5 animate-spin text-[#007BFF]" />
          ) : null}
          {fetchingModels ? t.settings.aiFetchingModels : t.settings.aiFetchModelsBtn}
        </button>

        <div className="flex min-w-[240px] flex-1 items-center gap-1.5">
          <input
            type="text"
            data-testid="settings-gemini-custom-model-input"
            value={customModelInput}
            onChange={(e) => setCustomModelInput(e.target.value)}
            placeholder={t.settings.aiCustomModelPlaceholder}
            className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
          />
          <button
            type="button"
            data-testid="settings-gemini-apply-model-btn"
            disabled={!customModelInput.trim() || saving || testing || fetchingModels}
            onClick={() => {
              const target = customModelInput.trim();
              setCustomModelInput("");
              void handleSelectModel(target);
            }}
            className="knit-control-sm knit-btn-secondary px-2.5 text-xs font-semibold disabled:opacity-50"
          >
            {t.settings.aiApplyModelBtn}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-[#6C757D]">
        <span>
          {t.settings.aiModelLabel}{" "}
          <strong className="text-[#343A40]">
            {status?.model ?? selectedModel}
          </strong>
        </span>
        <span>
          {t.settings.aiStorageLabel}{" "}
          <strong className="text-[#343A40]">{storageText}</strong>
        </span>
      </div>

      <div className="flex items-start gap-1.5 rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] px-3 py-2 text-xs text-[#495057]">
        <GeminiShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.settings.aiPrivacyNote}</span>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-1.5 rounded-[4px] border px-3 py-1.5 text-xs ${
            feedback.kind === "success"
              ? "border-[#C3E6CB] bg-[#D4EDDA] text-[#155724]"
              : "border-[#F5C6CB] bg-[#F8D7DA] text-[#721C24]"
          }`}
        >
          {feedback.kind === "success" ? (
            <GeminiCheckIcon className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <GeminiAlertIcon className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
};

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
            className="knit-control min-w-[240px] flex-1 rounded-[4px] border border-[#CED4DA] px-3 text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
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

      <GeminiAssistantSettingsCard />

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
