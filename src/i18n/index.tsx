import React from "react";
import { usePersistentState } from "../lib/storage";
import { en } from "./en";
import type { Language, Translations } from "./types";
import { vi } from "./vi";

export type { Language, Translations } from "./types";

const DICTIONARIES: Record<Language, Translations> = { vi, en };

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: Translations;
}

const I18nContext = React.createContext<I18nContextValue>({
  lang: "vi",
  setLang: () => {},
  t: vi,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLang] = usePersistentState<Language>("knit.lang", "vi");
  const value = React.useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang,
      t: DICTIONARIES[lang] ?? vi,
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return React.useContext(I18nContext);
}
