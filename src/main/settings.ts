import { app, globalShortcut } from "electron";
import { getSetting, setSetting } from "./store/db";
import * as monitor from "./monitor/engine";
import { setAlertConfig } from "./alerts/engine";
import { resolveLocale, setLocale } from "@shared/i18n";
import { DEFAULT_SETTINGS, SETTINGS_KEY, type AppSettings } from "@shared/settings";

let current: AppSettings = { ...DEFAULT_SETTINGS };
let toggleWindow: () => void = () => {};
let onLocaleChange: () => void = () => {};

export function setWindowToggle(fn: () => void): void {
  toggleWindow = fn;
}

/** main registers a hook to rebuild the app/tray menus when the language changes */
export function setLocaleChangeHandler(fn: () => void): void {
  onLocaleChange = fn;
}

export function getSettings(): AppSettings {
  return current;
}

/** base (window-visible) polling interval — used by main on window show */
export function fastInterval(): number {
  return current.pollIntervalMs;
}

function applyShortcut(accel: string): void {
  globalShortcut.unregisterAll();
  if (accel) {
    try {
      globalShortcut.register(accel, () => toggleWindow());
    } catch {
      /* invalid accelerator */
    }
  }
}

function applyAll(s: AppSettings): void {
  setLocale(resolveLocale(s.locale, app.getLocale()));
  monitor.control({ intervalMs: s.pollIntervalMs });
  setAlertConfig({
    contextWarnPct: s.contextWarnPct,
    quotaWarnPct: s.quotaWarnPct,
    cpuWarnPct: s.cpuWarnPct,
    memWarnPct: s.memWarnPct,
    burnWarnUsdPerMin: s.burnWarnUsdPerMin
  });
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.autoLaunch });
  }
  applyShortcut(s.globalShortcut);
}

/** load persisted settings and apply side-effects (call after db init) */
export function loadSettings(): AppSettings {
  current = { ...DEFAULT_SETTINGS, ...getSetting<Partial<AppSettings>>(SETTINGS_KEY, {}) };
  applyAll(current);
  return current;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const localeChanged = patch.locale !== undefined && patch.locale !== current.locale;
  current = { ...current, ...patch };
  setSetting(SETTINGS_KEY, current);
  applyAll(current);
  // menus are built once from strings; a language switch has to rebuild them
  if (localeChanged) onLocaleChange();
  return current;
}
