import { hostname, release, arch } from "node:os";
import { app, ipcMain } from "electron";
import { IpcChannels, type SystemInfo } from "@shared/ipc";
import { scanAgents } from "../discovery/engine";
import { scanSessions, auditSessions } from "../sessions/engine";
import * as monitor from "../monitor/engine";
import { getSettings, updateSettings } from "../settings";
import { scanStorage } from "../storage/engine";
import { getHistory, getSpend, type SpendRow } from "../store/db";
import type { SpendBucket } from "@shared/sessions";
import { getClaudeHookStatus, installClaudeHook } from "../sessions/claude-hook";

function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return platform;
  }
}

/**
 * Register all main-process IPC handlers.
 * P0: system info only. Discovery / monitor / alerts / actions land here per phase.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.systemInfo, (): SystemInfo => {
    return {
      hostname: hostname(),
      platform: process.platform,
      platformLabel: platformLabel(process.platform),
      arch: arch(),
      osRelease: release(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node
    };
  });

  ipcMain.handle(IpcChannels.discoveryScan, () => scanAgents());
  ipcMain.handle(IpcChannels.sessionsScan, () => scanSessions());
  ipcMain.handle(IpcChannels.sessionsAudit, () => auditSessions());

  ipcMain.on(IpcChannels.monitorSubscribe, (e) => monitor.addSubscriber(e.sender));
  ipcMain.on(IpcChannels.monitorUnsubscribe, (e) => monitor.removeSubscriber(e.sender));
  ipcMain.handle(IpcChannels.monitorControl, (_e, opts) => monitor.control(opts));
  ipcMain.handle(IpcChannels.monitorAction, (_e, { action, pid }) =>
    monitor.runAction(action, pid)
  );

  ipcMain.handle(IpcChannels.settingsGet, () => getSettings());
  ipcMain.handle(IpcChannels.settingsSet, (_e, patch) => updateSettings(patch));
  ipcMain.handle(IpcChannels.storageScan, (_e, path: string) => scanStorage(path));
  ipcMain.handle(IpcChannels.historyGet, () => {
    const rows = getHistory(Date.now() - 60 * 60 * 1000, 60);
    return rows.map((r) => ({
      procs: r.procs,
      cpu: r.cpu,
      mem: r.mem,
      listenPorts: r.ports,
      alerts: r.alerts
    }));
  });

  ipcMain.handle(IpcChannels.claudeHookStatus, () => getClaudeHookStatus());
  ipcMain.handle(IpcChannels.claudeHookInstall, () => installClaudeHook());

  ipcMain.handle(IpcChannels.spendGet, () => {
    // keep raw values; the renderer rounds at display (fmtUsd) so per-agent and
    // total stay in the same rounding口径
    const bucket = (rows: SpendRow[]): SpendBucket => {
      const byAgent: Record<string, number> = {};
      let total = 0;
      let tokens = 0;
      for (const r of rows) {
        byAgent[r.agentId] = r.costUsd || 0;
        total += r.costUsd || 0;
        tokens += r.totalTokens || 0;
      }
      return { total, byAgent, tokens };
    };
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      today: bucket(getSpend(startOfDay)),
      week: bucket(getSpend(weekAgo)),
      month: bucket(getSpend(startOfMonth)),
      all: bucket(getSpend(0))
    };
  });
}
