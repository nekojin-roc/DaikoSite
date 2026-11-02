import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import zh from './zh.json';
import ja from './ja.json';

export type Language = 'en' | 'zh' | 'ja';
export const supportedLanguage = (value?: string): Language => {
  const language = value?.split('-')[0]?.toLowerCase();
  return language === 'zh' || language === 'ja' ? language : 'en';
};
const cookieName = 'parcelhub.language';
function readLanguageCookie(): string | undefined {
  try {
    const entry = document.cookie.split('; ').find(item => item.startsWith(`${cookieName}=`));
    return entry ? decodeURIComponent(entry.slice(cookieName.length + 1)) : undefined;
  } catch { return undefined; }
}
export async function changeLanguage(language: Language) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  try { document.cookie = `${cookieName}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`; }
  catch { /* Keep the choice for this visit when cookies are blocked. */ }
  await i18n.changeLanguage(language);
}

const savedLanguage = readLanguageCookie();
void i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh }, ja: { translation: ja } },
  lng: savedLanguage ? supportedLanguage(savedLanguage) : undefined,
  fallbackLng: 'en', supportedLngs: ['en', 'zh', 'ja'], nonExplicitSupportedLngs: true,
  load: 'languageOnly', initAsync: false, keySeparator: false,
  interpolation: { escapeValue: false },
  detection: { order: ['cookie', 'navigator'], caches: [], lookupCookie: cookieName },
  react: { useSuspense: false },
});
const setDocumentLanguage = (language: string) => {
  document.documentElement.lang = supportedLanguage(language);
  document.documentElement.dir = 'ltr';
};
setDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on('languageChanged', setDocumentLanguage);
// Cookies have no storage event; resync after returning from a ParcelHub tab.
const syncLanguage = () => {
  const value = readLanguageCookie();
  if (!value) return;
  const language = supportedLanguage(value);
  if (language !== supportedLanguage(i18n.resolvedLanguage ?? i18n.language)) void i18n.changeLanguage(language);
};
window.addEventListener('focus', syncLanguage);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncLanguage(); });
export default i18n;
