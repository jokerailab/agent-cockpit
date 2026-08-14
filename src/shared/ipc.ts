/**
 * Shared IPC contract between main and renderer.
 * Single source of truth for channel names and payload shapes.
 * Expand per phase (discovery, monitor, alerts, actions).
 */

export interface SystemInfo {
  hostname: string;
  platform: NodeJS.Platform;
  platformLabel: string;
  arch: string;
  osRelease: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
}

export const IpcChannels = {
  systemInfo: "system:info",
  discoveryScan: "discovery:scan",
  sessionsScan: "sessions:scan",
  sessionsAudit: "sessions:audit",
  monitorTick: "monitor:tick",
  monitorSubscribe: "monitor:subscribe",
  monitorUnsubscribe: "monitor:unsubscribe",
  monitorControl: "monitor:control",
  monitorAction: "monitor:action",
  openMain: "window:open-main",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  menuEvent: "menu:event",
  storageScan: "storage:scan",
  historyGet: "history:get",
  claudeHookStatus: "claude-hook:status",
  claudeHookInstall: "claude-hook:install",
  spendGet: "spend:get"
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** API surface exposed on window.cockpit via the preload bridge. */
export interface CockpitApi {
  getSystemInfo: () => Promise<SystemInfo>;
  scanAgents: () => Promise<import("./agents").DiscoveryResult>;
  scanSessions: () => Promise<import("./sessions").SessionScanResult>;
  auditSessions: () => Promise<import("./sessions").SessionAudit[]>;
  onMonitorTick: (cb: (snap: import("./monitor").MonitorSnapshot) => void) => () => void;
  monitorControl: (opts: { running?: boolean; intervalMs?: number }) => Promise<void>;
  monitorAction: (
    action: import("./monitor").MonitorAction,
    pid: number
  ) => Promise<import("./monitor").MonitorActionResult>;
  openMain: () => void;
  getSettings: () => Promise<import("./settings").AppSettings>;
  setSettings: (
    patch: Partial<import("./settings").AppSettings>
  ) => Promise<import("./settings").AppSettings>;
  /** menu/tray-driven events forwarded to the renderer (rescan / toggle-monitor / open-settings) */
  onMenuEvent: (cb: (event: string) => void) => () => void;
  scanStorage: (path: string) => Promise<import("./storage").StorageScan>;
  /** recent totals history (for seeding sparklines across restarts) */
  getHistory: () => Promise<import("./monitor").MonitorTotals[]>;
  /** Claude quota hook: current install state */
  getClaudeHookStatus: () => Promise<import("./sessions").ClaudeHookStatus>;
  /** Claude quota hook: install/repair (idempotent, backs up settings.json) */
  installClaudeHook: () => Promise<import("./sessions").ClaudeHookInstallResult>;
  /** spend rollups (today / week / month / all) from the session ledger */
  getSpend: () => Promise<import("./sessions").SpendSummary>;
}
