import React from "react";
import { Code2, FileJson, FileText, Save, Sparkles, X } from "lucide-react";
import { useI18n } from "../i18n";
import { JsonCodeEditor } from "./JsonCodeEditor";
import {
  applyFormToJsonObject,
  createDefaultInfoTemplate,
  jsonObjectToForm,
  parseInfoJsonObject,
  type StoryInfoFormValues,
} from "../lib/mangaInfo";
import type { Story } from "../types/ipc";

interface MangaInfoModalProps {
  story: Story;
  isNewFile: boolean;
  initialJsonText: string;
  loading: boolean;
  errorMsg: string | null;
  saving: boolean;
  onSave: (jsonText: string, parsedObj: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

export const MangaInfoModal: React.FC<MangaInfoModalProps> = ({
  story,
  isNewFile,
  initialJsonText,
  loading,
  errorMsg,
  saving,
  onSave,
  onClose,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = React.useState<"form" | "raw">("form");
  const [rawText, setRawText] = React.useState<string>(initialJsonText);
  const [baseObj, setBaseObj] = React.useState<Record<string, unknown>>(() => {
    const parsed = parseInfoJsonObject(initialJsonText);
    return parsed.ok ? parsed.obj : createDefaultInfoTemplate(story.dir_name);
  });
  const [formValues, setFormValues] = React.useState<StoryInfoFormValues>(() => {
    const parsed = parseInfoJsonObject(initialJsonText);
    return jsonObjectToForm(
      parsed.ok ? parsed.obj : createDefaultInfoTemplate(story.dir_name),
      story.dir_name,
    );
  });
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setRawText(initialJsonText);
    const parsed = parseInfoJsonObject(initialJsonText);
    if (parsed.ok) {
      setBaseObj(parsed.obj);
      setFormValues(jsonObjectToForm(parsed.obj, story.dir_name));
      setLocalError(null);
    } else if (!loading && initialJsonText.trim().length > 0) {
      // File đang tồn tại bị lỗi cú pháp JSON -> mở thẳng tab Raw JSON để user sửa
      setActiveTab("raw");
      setLocalError(t.mangaPack.invalidJsonError);
    }
  }, [initialJsonText, loading, story.dir_name, t.mangaPack.invalidJsonError]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, saving]);

  const switchToTab = (nextTab: "form" | "raw") => {
    if (nextTab === activeTab) return;
    if (nextTab === "raw") {
      const merged = applyFormToJsonObject(baseObj, formValues);
      setBaseObj(merged);
      setRawText(JSON.stringify(merged, null, 2));
      setLocalError(null);
      setActiveTab("raw");
    } else {
      const parsed = parseInfoJsonObject(rawText);
      if (!parsed.ok) {
        setLocalError(t.mangaPack.invalidJsonError);
        return;
      }
      setBaseObj(parsed.obj);
      setFormValues(jsonObjectToForm(parsed.obj, story.dir_name));
      setLocalError(null);
      setActiveTab("form");
    }
  };

  const handleFormatJson = () => {
    const parsed = parseInfoJsonObject(rawText);
    if (!parsed.ok) {
      setLocalError(t.mangaPack.invalidJsonError);
      return;
    }
    setLocalError(null);
    setRawText(JSON.stringify(parsed.obj, null, 2));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || loading) return;

    if (activeTab === "form") {
      const merged = applyFormToJsonObject(baseObj, formValues);
      setBaseObj(merged);
      const formatted = `${JSON.stringify(merged, null, 2)}\n`;
      setRawText(formatted);
      setLocalError(null);
      await onSave(formatted, merged);
    } else {
      const parsed = parseInfoJsonObject(rawText);
      if (!parsed.ok) {
        setLocalError(t.mangaPack.invalidJsonError);
        return;
      }
      setLocalError(null);
      const formatted = rawText.endsWith("\n") ? rawText : `${rawText}\n`;
      await onSave(formatted, parsed.obj);
    }
  };

  const combinedError = localError || errorMsg;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.mangaPack.infoJsonTitle}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#212529]/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-[4px] border border-[#CED4DA] bg-white"
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <FileJson className="h-4 w-4 shrink-0 text-[#007BFF]" />
            <span className="truncate text-base font-bold text-[#212529]">
              {t.mangaPack.infoJsonTitle} — {story.dir_name}
            </span>
            {isNewFile && (
              <span className="shrink-0 rounded-[4px] bg-[#E7F1FF] px-2 py-0.5 text-xs font-semibold text-[#0056B3]">
                {t.mangaPack.infoModalNewBadge}
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-[4px] p-1 text-[#6C757D] hover:bg-[#E9ECEF] disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-white px-4 pt-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => switchToTab("form")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === "form"
                  ? "border-[#007BFF] text-[#007BFF]"
                  : "border-transparent text-[#6C757D] hover:text-[#212529]"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              {t.mangaPack.infoTabForm}
            </button>
            <button
              type="button"
              onClick={() => switchToTab("raw")}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${
                activeTab === "raw"
                  ? "border-[#007BFF] text-[#007BFF]"
                  : "border-transparent text-[#6C757D] hover:text-[#212529]"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              {t.mangaPack.infoTabRaw}
            </button>
          </div>

          {activeTab === "raw" && (
            <button
              type="button"
              onClick={handleFormatJson}
              className="mb-1 inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 py-1 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
            >
              <Sparkles className="h-3.5 w-3.5 text-[#007BFF]" />
              {t.mangaPack.formatJsonBtn}
            </button>
          )}
        </div>

        {/* Error banner */}
        {combinedError && (
          <div className="border-b border-[#F5C6CB] bg-[#F8D7DA] px-4 py-2 text-xs text-[#721C24]">
            {combinedError}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-[#6C757D]">{t.common.processing}</div>
          ) : activeTab === "form" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldTitle}
                  </span>
                  <input
                    type="text"
                    value={formValues.title}
                    onChange={(e) => setFormValues((p) => ({ ...p, title: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldAuthors}
                  </span>
                  <input
                    type="text"
                    value={formValues.author}
                    placeholder={t.mangaPack.commaSeparatedHint}
                    onChange={(e) => setFormValues((p) => ({ ...p, author: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldGenres}
                  </span>
                  <input
                    type="text"
                    value={formValues.genres}
                    placeholder={t.mangaPack.commaSeparatedHint}
                    onChange={(e) => setFormValues((p) => ({ ...p, genres: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldOtherTitles}
                  </span>
                  <input
                    type="text"
                    value={formValues.other_titles}
                    placeholder={t.mangaPack.commaSeparatedHint}
                    onChange={(e) => setFormValues((p) => ({ ...p, other_titles: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldNation}
                  </span>
                  <input
                    type="text"
                    value={formValues.nation}
                    onChange={(e) => setFormValues((p) => ({ ...p, nation: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldNationId}
                  </span>
                  <input
                    type="text"
                    value={formValues.nation_id}
                    onChange={(e) => setFormValues((p) => ({ ...p, nation_id: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 font-mono-code text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldType}
                  </span>
                  <input
                    type="text"
                    value={formValues.type}
                    onChange={(e) => setFormValues((p) => ({ ...p, type: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldStatus}
                  </span>
                  <input
                    type="text"
                    value={formValues.status}
                    onChange={(e) => setFormValues((p) => ({ ...p, status: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldPosterId}
                  </span>
                  <input
                    type="text"
                    value={formValues.poster_id}
                    onChange={(e) => setFormValues((p) => ({ ...p, poster_id: e.target.value }))}
                    className="knit-control w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 font-mono-code text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="block text-xs font-semibold text-[#495057]">
                    {t.mangaPack.fieldDescription}
                  </span>
                  <textarea
                    rows={5}
                    value={formValues.description}
                    onChange={(e) =>
                      setFormValues((p) => ({ ...p, description: e.target.value }))
                    }
                    className="w-full rounded-[4px] border border-[#CED4DA] bg-white p-2.5 text-sm text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                </label>
              </div>
            </div>
          ) : (
            <JsonCodeEditor
              value={rawText}
              onChange={setRawText}
              height="360px"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="knit-control rounded-[4px] border border-[#CED4DA] bg-white px-3.5 text-sm font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={saving || loading}
            className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {t.mangaPack.saveInfoJsonBtn}
          </button>
        </div>
      </form>
    </div>
  );
};
