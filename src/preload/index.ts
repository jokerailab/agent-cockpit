import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IpcChannels, type CockpitApi } from "@shared/ipc";
import type { MonitorSnapshot } from "@shared/monitor";

const api: CockpitApi = {
  getSystemInfo: () => ipcRenderer.invoke(IpcChannels.systemInfo),
  scanAgents: () => ipcRenderer.invoke(IpcChannels.discoveryScan),
  scanSessions: () => ipcRenderer.invoke(IpcChannels.sessionsScan),
  auditSessions: () => ipcRenderer.invoke(IpcChannels.sessionsAudit),
  onMonitorTick: (cb) => {
    const listener = (_e: IpcRendererEvent, snap: MonitorSnapshot) => cb(snap);
    ipcRenderer.on(IpcChannels.monitorTick, listener);
    ipcRenderer.send(IpcChannels.monitorSubscribe);
    return () => {
      ipcRenderer.removeListener(IpcChannels.monitorTick, listener);
      ipcRenderer.send(IpcChannels.monitorUnsubscribe);
    };
  },
  monitorControl: (opts) => ipcRenderer.invoke(IpcChannels.monitorControl, opts),
  monitorAction: (action, pid) => ipcRenderer.invoke(IpcChannels.monitorAction, { action, pid }),
  openMain: () => ipcRenderer.send(IpcChannels.openMain),
  getSettings: () => ipcRenderer.invoke(IpcChannels.settingsGet),
  setSettings: (patch) => ipcRenderer.invoke(IpcChannels.settingsSet, patch),
  onMenuEvent: (cb) => {
    const listener = (_e: IpcRendererEvent, event: string) => cb(event);
    ipcRenderer.on(IpcChannels.menuEvent, listener);
    return () => ipcRenderer.removeListener(IpcChannels.menuEvent, listener);
  },
  scanStorage: (path) => ipcRenderer.invoke(IpcChannels.storageScan, path),
  getHistory: () => ipcRenderer.invoke(IpcChannels.historyGet),
  getClaudeHookStatus: () => ipcRenderer.invoke(IpcChannels.claudeHookStatus),
  installClaudeHook: () => ipcRenderer.invoke(IpcChannels.claudeHookInstall),
  getSpend: () => ipcRenderer.invoke(IpcChannels.spendGet)
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("cockpit", api);
} else {
  // Fallback when context isolation is disabled (should not happen in prod).
  (globalThis as unknown as { cockpit: CockpitApi }).cockpit = api;
}
