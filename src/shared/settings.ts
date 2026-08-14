/** App settings — persisted in SQLite, applied in main, edited in renderer. */
import type { LocalePref } from "./i18n";

/** Per-agent billing context — drives how token cost is framed in the UI. */
export interface AgentBilling {
  /** api = pay-per-token (literal $); subscription = flat plan (equivalent value / ROI); unknown = estimate */
  mode: "api" | "subscription" | "unknown";
  /** monthly plan price in USD (for subscription ROI) */
  planMonthlyUsd?: number;
}

export interface AppSettings {
  /** UI language; "auto" follows the OS locale */
  locale: LocalePref;
  /** live polling interval while the window is visible (ms) */
  pollIntervalMs: number;
  /** launch at login (packaged builds only) */
  autoLaunch: boolean;
  /** global shortcut accelerator to toggle the window ("" = disabled) */
  globalShortcut: string;
  /** alert thresholds */
  contextWarnPct: number; // 0..1
  quotaWarnPct: number; // 0..100
  cpuWarnPct: number; // 0..100 per-process
  memWarnPct: number; // 0..100 per-process
  burnWarnUsdPerMin: number; // session equivalent-cost burn rate ($/min) to warn
  /** fire OS notifications for newly-raised alerts */
  notifyEnabled: boolean;
  /** minimum severity that triggers a notification */
  notifyMinSeverity: "warn" | "critical";
  /** notify when an agent finishes its turn and is waiting on you */
  notifyAwaiting: boolean;
  /** per-agent billing context (keyed by agent id), for cost framing */
  billing: Record<string, AgentBilling>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  locale: "auto",
  pollIntervalMs: 2500,
  autoLaunch: false,
  globalShortcut: "",
  contextWarnPct: 0.8,
  quotaWarnPct: 80,
  cpuWarnPct: 90,
  memWarnPct: 15,
  burnWarnUsdPerMin: 8,
  notifyEnabled: true,
  notifyMinSeverity: "warn",
  notifyAwaiting: true,
  billing: {}
};

export const SETTINGS_KEY = "appSettings";
