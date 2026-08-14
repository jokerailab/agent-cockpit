/**
 * Minimal i18n shared by main and renderer.
 *
 * Both processes translate: OS notifications, the tray menu and the app menu
 * are emitted from main, while everything on screen comes from the renderer.
 * A single dictionary keeps them from drifting, so `Alert` and `AgentSession`
 * carry already-rendered strings across IPC rather than key/param pairs.
 *
 * No i18n library: the only feature needed is `{name}` interpolation, which is
 * three lines. `en` is the source of truth for the key set; every other locale
 * is type-checked against it, so a missing translation fails `npm run typecheck`
 * rather than surfacing as a blank label at runtime.
 */
import { en, type I18nKey } from "./en";
import { zhCN } from "./zh-CN";

export type { I18nKey };
export type Locale = "en" | "zh-CN";
/** What the user picked; "auto" defers to the OS. */
export type LocalePref = "auto" | Locale;

export const LOCALES: Locale[] = ["en", "zh-CN"];

const DICTS: Record<Locale, Record<I18nKey, string>> = {
  en,
  "zh-CN": zhCN
};

let current: Locale = "en";

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/**
 * Resolve a preference against an OS locale string (`app.getLocale()` in main,
 * `navigator.language` in the renderer). Anything Chinese maps to zh-CN;
 * everything else falls back to English.
 */
export function resolveLocale(pref: LocalePref, systemLocale: string): Locale {
  if (pref !== "auto") return pref;
  return systemLocale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/**
 * Translate a key, interpolating `{placeholders}`. An absent placeholder is
 * left verbatim rather than rendered as "undefined", so a wiring mistake is
 * visible without corrupting the sentence.
 */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const template = DICTS[current][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match
  );
}
