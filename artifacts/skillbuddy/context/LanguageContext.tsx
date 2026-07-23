import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type LanguageCode = 'en' | 'de' | 'et' | 'lv' | 'lt';

const LANG_KEY = 'sb_language';

// Translation dictionary — currently covers the highest-visibility, most
// frequently seen strings (tab bar, Home headings, common actions) as a
// working foundation. Extending coverage to every string in the app is a
// large follow-up task (40+ screens) tracked separately.
const STRINGS: Record<LanguageCode, Record<string, string>> = {
  en: {
    tab_home: 'Home',
    tab_services: 'Services',
    tab_jobs: 'Jobs',
    tab_inbox: 'Inbox',
    tab_profile: 'Profile',
    home_heading: 'What service do you need today?',
    home_credit_points: 'Credit Points',
    home_earn_note: 'Earn 1 pt per €1 spent',
    home_categories: 'Categories',
    home_special_for_you: 'Special For You',
    see_all: 'See all',
    search_placeholder: 'Search for a service...',
    post_a_job: 'Post a Job',
    book_now: 'Book Now',
  },
  de: {
    tab_home: 'Start',
    tab_services: 'Dienste',
    tab_jobs: 'Aufträge',
    tab_inbox: 'Posteingang',
    tab_profile: 'Profil',
    home_heading: 'Welchen Service brauchst du heute?',
    home_credit_points: 'Punkte',
    home_earn_note: '1 Punkt pro €1 Ausgabe',
    home_categories: 'Kategorien',
    home_special_for_you: 'Nur für dich',
    see_all: 'Alle ansehen',
    search_placeholder: 'Dienst suchen...',
    post_a_job: 'Auftrag erstellen',
    book_now: 'Jetzt buchen',
  },
  et: {
    tab_home: 'Avaleht',
    tab_services: 'Teenused',
    tab_jobs: 'Tööd',
    tab_inbox: 'Sõnumid',
    tab_profile: 'Profiil',
    home_heading: 'Millist teenust täna vajad?',
    home_credit_points: 'Krediidipunktid',
    home_earn_note: 'Teeni 1 punkt iga kulutatud €1 kohta',
    home_categories: 'Kategooriad',
    home_special_for_you: 'Just sinu jaoks',
    see_all: 'Vaata kõiki',
    search_placeholder: 'Otsi teenust...',
    post_a_job: 'Postita töö',
    book_now: 'Broneeri kohe',
  },
  lv: {
    tab_home: 'Sākums',
    tab_services: 'Pakalpojumi',
    tab_jobs: 'Darbi',
    tab_inbox: 'Iesūtne',
    tab_profile: 'Profils',
    home_heading: 'Kāds pakalpojums šodien nepieciešams?',
    home_credit_points: 'Kredītpunkti',
    home_earn_note: 'Nopelni 1 punktu par katru iztērēto €1',
    home_categories: 'Kategorijas',
    home_special_for_you: 'Tieši jums',
    see_all: 'Skatīt visu',
    search_placeholder: 'Meklēt pakalpojumu...',
    post_a_job: 'Publicēt darbu',
    book_now: 'Rezervēt tagad',
  },
  lt: {
    tab_home: 'Pradžia',
    tab_services: 'Paslaugos',
    tab_jobs: 'Darbai',
    tab_inbox: 'Gautieji',
    tab_profile: 'Profilis',
    home_heading: 'Kokios paslaugos jums reikia šiandien?',
    home_credit_points: 'Kredito taškai',
    home_earn_note: 'Uždirbkite 1 tašką už kiekvieną išleistą €1',
    home_categories: 'Kategorijos',
    home_special_for_you: 'Specialiai jums',
    see_all: 'Žiūrėti viską',
    search_placeholder: 'Ieškoti paslaugos...',
    post_a_job: 'Skelbti darbą',
    book_now: 'Rezervuoti dabar',
  },
};

interface LanguageContextType {
  language: LanguageCode;
  setLanguage: (lang: LanguageCode) => void;
  t: (key: keyof typeof STRINGS['en']) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key) => STRINGS.en[key] ?? key,
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
    (key: keyof typeof STRINGS['en']) => STRINGS[language][key] ?? STRINGS.en[key] ?? key,
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
