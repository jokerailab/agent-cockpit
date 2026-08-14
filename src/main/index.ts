import { join } from "node:path";
import { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc";
import { createTrayIcon, createOpenIcon, createAlertIcon, createOpenSweep } from "./tray-icon";
import { initDb, getSetting, setSetting } from "./store/db";
import * as monitor from "./monitor/engine";
import { scanSessions } from "./sessions/engine";
import { processAlerts, processSessionActivity, setNotifyActivate } from "./alerts/notify";
import {
  loadSettings,
  setWindowToggle,
  setLocaleChangeHandler,
  fastInterval,
  getSettings
} from "./settings";
import { t } from "@shared/i18n";
import { IpcChannels } from "@shared/ipc";
import type { MonitorSnapshot } from "@shared/monitor";

let mainWindow: BrowserWindow | null = null;
let popover: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayMenu: Electron.Menu | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;
const POP_W = 380;
const POP_H = 560;

app.setName("Agent Cockpit");

interface WinBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

function createWindow(): void {
  const saved = getSetting<WinBounds>("windowBounds", { width: 1380, height: 940 });
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: "Agent Cockpit",
    backgroundColor: "#ece5d3",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  const persistBounds = (): void => {
    if (mainWindow && !mainWindow.isMinimized()) {
      setSetting("windowBounds", mainWindow.getBounds());
    }
  };
  mainWindow.on("resized", persistBounds);
  mainWindow.on("moved", persistBounds);

  // window-close → hide to tray AND pause live monitoring (resume on show)
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      persistBounds();
      mainWindow?.hide();
    }
  });
  // adaptive polling — only spend CPU when the user is actually looking:
  //   focused & visible → fast (settings interval)
  //   visible but unfocused → medium (10s)
  //   hidden (tray) → slow (30s, just keeps the menu-bar fresh)
  // hidden: still poll sessions (slower) so "agent needs you" fires while away
  mainWindow.on("hide", () => {
    monitor.control({ intervalMs: 30000 });
    startSessionPolling(20000);
  });
  mainWindow.on("show", () => {
    monitor.control({ intervalMs: fastInterval() });
    startSessionPolling(5000);
  });
  mainWindow.on("focus", () => monitor.control({ intervalMs: fastInterval() }));
  mainWindow.on("blur", () => {
    if (mainWindow?.isVisible()) monitor.control({ intervalMs: 10000 });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (isDev && devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow(): void {
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

function sendMenu(event: string): void {
  showWindow();
  mainWindow?.webContents.send(IpcChannels.menuEvent, event);
}

function buildAppMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: "Agent Cockpit",
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { label: t("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => sendMenu("open-settings") },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { type: "separator" as const },
              { label: t("menu.quit"), click: () => { isQuitting = true; app.quit(); } }
            ]
          }
        ]
      : []),
    {
      label: t("menu.actions"),
      submenu: [
        { label: t("menu.rescan"), accelerator: "CmdOrCtrl+R", click: () => sendMenu("rescan") },
        { label: t("menu.toggleMonitor"), accelerator: "CmdOrCtrl+P", click: () => sendMenu("toggle-monitor") },
        { type: "separator" },
        { label: t("menu.settings"), accelerator: "CmdOrCtrl+,", click: () => sendMenu("open-settings") }
      ]
    },
    {
      label: t("menu.edit"),
      submenu: [
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: t("menu.view"),
      submenu: [
        ...(isDev
          ? ([{ role: "reload" }, { role: "toggleDevTools" }] as Electron.MenuItemConstructorOptions[])
          : []),
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createPopover(): void {
  popover = new BrowserWindow({
    width: POP_W,
    height: POP_H,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (isDev && devUrl) {
    void popover.loadURL(`${devUrl}/popover.html`);
  } else {
    void popover.loadFile(join(__dirname, "../renderer/popover.html"));
  }
  popover.on("blur", () => popover?.hide());
  popover.on("hide", () => applyTrayState());
}

function togglePopover(): void {
  if (!popover) createPopover();
  if (!popover || !tray) return;
  if (popover.isVisible()) {
    popover.hide();
    return;
  }
  const tb = tray.getBounds();
  const x = Math.round(tb.x + tb.width / 2 - POP_W / 2);
  const y = Math.round(tb.y + tb.height + 2);
  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
  playOpenSweep();
}

function makeIcon(buf: Buffer): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(buf, { scaleFactor: 2 });
  if (process.platform === "darwin") img.setTemplateImage(true);
  return img;
}

let restIcon: Electron.NativeImage | null = null;
let openIcon: Electron.NativeImage | null = null;
let alertIcon: Electron.NativeImage | null = null;
let sweepFrames: Electron.NativeImage[] = [];
let sweepTimer: NodeJS.Timeout | null = null;
let lastAlerts = 0;

/** static icon reflecting current state (no continuous animation) */
function applyTrayState(): void {
  if (!tray) return;
  if (sweepTimer) return; // mid one-shot sweep; let it finish
  if (popover?.isVisible()) tray.setImage(openIcon!);
  else if (lastAlerts > 0) tray.setImage(alertIcon!);
  else tray.setImage(restIcon!);
}

/** one-shot rest→open sweep when the popover opens (not looping) */
function playOpenSweep(): void {
  if (!tray || sweepFrames.length === 0) return;
  if (sweepTimer) clearInterval(sweepTimer);
  let i = 0;
  sweepTimer = setInterval(() => {
    if (i >= sweepFrames.length) {
      clearInterval(sweepTimer!);
      sweepTimer = null;
      applyTrayState();
      return;
    }
    tray?.setImage(sweepFrames[i]!);
    i++;
  }, 45);
}

// main-side session poller — runs regardless of window state so the "agent
// needs you" notification fires even when the cockpit is hidden in the tray.
let sessionTimer: NodeJS.Timeout | null = null;

async function pollSessions(): Promise<void> {
  try {
    const r = await scanSessions();
    const s = getSettings();
    processSessionActivity(r.sessions, {
      enabled: s.notifyEnabled,
      awaitingEnabled: s.notifyAwaiting,
      windowActive: !!mainWindow && mainWindow.isVisible() && mainWindow.isFocused()
    });
  } catch {
    /* ignore a bad scan */
  }
}

function startSessionPolling(intervalMs: number): void {
  if (sessionTimer) clearInterval(sessionTimer);
  void pollSessions();
  sessionTimer = setInterval(() => void pollSessions(), intervalMs);
}

function updateTray(snap: MonitorSnapshot): void {
  if (!tray) return;
  const totals = snap.totals;
  tray.setToolTip(
    t("tray.tooltip", { procs: totals.procs, cpu: totals.cpu, alerts: totals.alerts })
  );
  lastAlerts = totals.alerts;
  applyTrayState();
  const s = getSettings();
  processAlerts(snap.alerts, { enabled: s.notifyEnabled, minSeverity: s.notifyMinSeverity });
}

function createTray(): void {
  restIcon = makeIcon(createTrayIcon());
  openIcon = makeIcon(createOpenIcon());
  alertIcon = makeIcon(createAlertIcon());
  sweepFrames = createOpenSweep().map(makeIcon);
  tray = new Tray(restIcon);
  tray.setToolTip("Agent Cockpit");
  buildTrayMenu();
  // left click → popover (iStat-style); right click → context menu
  tray.on("click", () => togglePopover());
  tray.on("right-click", () => {
    if (trayMenu) tray?.popUpContextMenu(trayMenu);
  });
}

/** (Re)build the tray context menu. Rebuilt on language change — menu labels
 * are baked in at construction time, so a locale switch has to redo them. */
function buildTrayMenu(): void {
  trayMenu = Menu.buildFromTemplate([
    { label: t("tray.open"), click: () => showWindow() },
    { label: t("tray.rescan"), click: () => sendMenu("rescan") },
    { label: t("menu.toggleMonitor"), click: () => sendMenu("toggle-monitor") },
    { label: t("menu.settings"), click: () => sendMenu("open-settings") },
    { type: "separator" },
    { label: t("tray.quit"), click: () => { isQuitting = true; app.quit(); } }
  ]);
}

// single-instance lock — focus existing window on second launch
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    initDb();
    registerIpcHandlers();
    setWindowToggle(toggleMainWindow);
    // settings must load BEFORE any menu is built: it resolves the locale, and
    // menu labels are translated once at construction time.
    loadSettings(); // apply locale / interval / alert thresholds / login item / shortcut
    setLocaleChangeHandler(() => {
      buildAppMenu();
      buildTrayMenu();
    });
    buildAppMenu();
    createWindow();
    createPopover();
    createTray();
    monitor.setTickListener(updateTray);
    setNotifyActivate(showWindow); // clicking a notification opens the cockpit
    startSessionPolling(5000); // watch sessions for "agent needs you" transitions
    ipcMain.on(IpcChannels.openMain, () => {
      popover?.hide();
      showWindow();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });
}

app.on("window-all-closed", () => {
  // tray-resident: stay alive
});

app.on("before-quit", () => { isQuitting = true; });
