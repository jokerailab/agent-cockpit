/** Alert engine — shared shapes (main evaluates rules, renderer renders panel). */

export type AlertSeverity = "info" | "warn" | "critical";

export type AlertCategory =
  | "context"
  | "quota"
  | "resource"
  | "port"
  | "security"
  | "burn"
  | "health";

export interface Alert {
  /** stable fingerprint so the same condition de-dupes across ticks */
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** agent id this alert relates to, if any */
  agentId: string | null;
  /** epoch ms when first raised */
  since: number;
}

/** User-tunable thresholds (defaults baked in; settings UI later). */
export interface AlertConfig {
  contextWarnPct: number; // 0..1 context window usage to warn (compaction approaching)
  quotaWarnPct: number; // 0..100 rate-limit usage to warn
  cpuWarnPct: number; // per-process sustained cpu %
  cpuSustainTicks: number; // consecutive ticks above cpu threshold before firing
  memWarnPct: number; // per-process memory %
  burnWarnUsdPerMin: number; // session equivalent-cost burn rate ($/min) to warn
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  contextWarnPct: 0.8,
  quotaWarnPct: 80,
  cpuWarnPct: 90,
  cpuSustainTicks: 3,
  memWarnPct: 15,
  burnWarnUsdPerMin: 8
};
