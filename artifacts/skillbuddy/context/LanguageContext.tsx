import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '@/context/translations/en';
import de from '@/context/translations/de';
import et from '@/context/translations/et';
import lv from '@/context/translations/lv';
import lt from '@/context/translations/lt';

export type LanguageCode = 'en' | 'de' | 'et' | 'lv' | 'lt';

const LANG_KEY = 'sb_language';

// Translation dictionaries — full coverage for every key across all 5
// supported languages (en/de/et/lv/lt). Every key defined in `en` exists in
// each of the other files, so there are no fallback-to-English gaps.
const STRINGS: Record<LanguageCode, Record<string, string>> = { en, de, et, lv, lt };

export type TranslationKey = keyof typeof en;

type Vars = Record<string, string | number>;

/** Replaces `{token}` placeholders with values, e.g. t('x', { n: 3 }). */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match
  );
}

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: TranslationKey, vars?: Vars) => string;
  /** Translates a category display name by its data id (e.g. '3' → 'Plumbing'). */
  tCat: (categoryId: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => STRINGS.en[key] ?? String(key),
  tCat: (id) => STRINGS.en[`cat_${id}`] ?? '',
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>('en');

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved && saved in STRINGS) setLanguageState(saved as LanguageCode);
    });
  }, []);

  const setLanguage = useCallback((lang: LanguageCode) => {
    setLanguageState(lang);
    AsyncStorage.setItem(LANG_KEY, lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Vars) => {
      const template = STRINGS[language][key] ?? STRINGS.en[key] ?? String(key);
      return interpolate(template, vars);
    },
    [language]
  );

  const tCat = useCallback(
    (categoryId: string) => {
      const key = `cat_${categoryId}` as TranslationKey;
      return STRINGS[language][key] ?? STRINGS.en[key] ?? '';
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tCat }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
