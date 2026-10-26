import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Language, Gift } from "@/shared/model";
import {
  defaultLocale,
  localeStorageKey,
  localeTag,
  parseLocale,
  translate,
  translateText,
} from "./locale";

function contextValue(locale: Language, setLocale: (locale: Language) => void) {
  return {
    locale,
    setLocale,
    tag: localeTag(locale),
    t: (
      message: Parameters<typeof translate>[1],
      values?: Parameters<typeof translate>[2],
    ) => translate(locale, message, values),
    text: (value: string) => translateText(locale, value),
    words: (value: Gift) => value[locale],
  };
}
const LocaleContext = createContext(contextValue(defaultLocale, () => {}));

export function LocaleProvider({ children }: { children: ReactNode }) {
  // A deterministic English server snapshot avoids hydration mismatches. A
  // saved explicit choice is restored after hydration, independent of browser language.
  const [locale, update] = useState<Language>(defaultLocale);
  useEffect(() => {
    try {
      update(parseLocale(localStorage.getItem(localeStorageKey)));
    } catch {
      /* Private browsing still supports in-memory selection. */
    }
    const changed = (event: StorageEvent) => {
      if (event.key === localeStorageKey || event.key === null)
        update(parseLocale(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const value = useMemo(
    () =>
      contextValue(locale, (next) => {
        update(next);
        try {
          localStorage.setItem(localeStorageKey, next);
        } catch {
          /* Keep the choice for this window. */
        }
      }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
export const useI18n = () => useContext(LocaleContext);
