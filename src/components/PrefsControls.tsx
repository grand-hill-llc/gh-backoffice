import { useT } from "../i18n";
import { LANGS, THEMES, usePrefs } from "../lib/prefs";

/** Theme (system / light / dark) and language switches, used inside the account menu. */
export function PrefsControls({ idPrefix }: { idPrefix: string }) {
  const { theme, setTheme, lang, setLang } = usePrefs();
  const t = useT();

  return (
    <div className="prefs">
      <div className="prefs-row">
        <span className="gh-label" id={`${idPrefix}-theme`}>{t.prefs.theme}</span>
        <div className="segmented" role="group" aria-labelledby={`${idPrefix}-theme`}>
          {THEMES.map((th) => (
            <button key={th} type="button" aria-pressed={theme === th} onClick={() => setTheme(th)}>
              {t.prefs.themes[th]}
            </button>
          ))}
        </div>
      </div>
      <div className="prefs-row">
        <span className="gh-label" id={`${idPrefix}-lang`}>{t.prefs.language}</span>
        <div className="segmented" role="group" aria-labelledby={`${idPrefix}-lang`}>
          {LANGS.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {t.prefs.langs[l]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Compact ES | EN switch for screens without the account menu (sign-in, password reset). */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, setLang } = usePrefs();
  const t = useT();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label={t.prefs.language}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} title={t.prefs.langs[l]}>
          {t.prefs.langShort[l]}
        </button>
      ))}
    </div>
  );
}
