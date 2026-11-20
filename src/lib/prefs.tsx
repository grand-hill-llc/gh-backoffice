import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Per-browser UI preferences: colour theme and language. */
export type Theme = "system" | "light" | "dark";
export type Lang = "es" | "en";

export const THEMES: Theme[] = ["system", "light", "dark"];
export const LANGS: Lang[] = ["es", "en"];

const THEME_KEY = "gh-theme";
const LANG_KEY = "gh-lang";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the choice just won't persist */
  }
}

function initialTheme(): Theme {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

/** Saved choice, else Spanish (the team's working language), whatever the browser's language is. */
function initialLang(): Lang {
  const v = read(LANG_KEY);
  return v === "en" ? "en" : "es";
}

/** "system" removes the attribute so CSS falls back to prefers-color-scheme. Mirrors the inline script in index.html. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

type Prefs = { theme: Theme; setTheme: (t: Theme) => void; lang: Lang; setLang: (l: Lang) => void };

const PrefsContext = createContext<Prefs | undefined>(undefined);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    write(THEME_KEY, t);
  };
  const setLang = (l: Lang) => {
    setLangState(l);
    write(LANG_KEY, l);
  };

  return <PrefsContext.Provider value={{ theme, setTheme, lang, setLang }}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}
