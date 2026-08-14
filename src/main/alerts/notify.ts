import { app, Notification } from "electron";
import { t } from "@shared/i18n";
import type { Alert, AlertSeverity } from "@shared/alerts";
import type { AgentSession } from "@shared/sessions";

/**
 * Turns the alert engine's output into OS-level signals: system notifications
 * for newly-raised alerts plus a dock badge count. This is what makes the tool
 * worth keeping open — it interrupts you when something matters instead of
 * waiting to be looked at.
 */

const SEV_RANK: Record<AlertSeverity, number> = { info: 0, warn: 1, critical: 2 };
const CAT_KEYS = ["context", "quota", "resource", "port", "security", "burn", "health"] as const;
type CatKey = (typeof CAT_KEYS)[number];
const isCatKey = (c: string): c is CatKey => (CAT_KEYS as readonly string[]).includes(c);
/** Localised category tag for the notification title. */
const catLabel = (c: string): string => (isCatKey(c) ? t(`alert.cat.${c}`) : c);

/** ids we've already notified about and that are still active */
let notified = new Set<string>();
/** seeded on the first tick so we don't flood notifications for pre-existing
 * conditions at launch — only alerts that appear AFTER startup notify. */
let primed = false;
let onActivate: () => void = () => {};

export function setNotifyActivate(fn: () => void): void {
  onActivate = fn;
}

export interface NotifyOptions {
  enabled: boolean;
  minSeverity: AlertSeverity;
}

/** Fire notifications for newly-appeared alerts; maintain the dock badge. */
export function processAlerts(alerts: Alert[], opts: NotifyOptions): void {
  const active = alerts.filter((a) => a.severity !== "info");

  // dock badge = count of active warn+critical (macOS/Linux; no-op on Windows)
  try {
    app.setBadgeCount(active.length);
  } catch {
    /* unsupported platform */
  }

  const present = new Set(active.map((a) => a.id));
  // drop resolved ids so the same condition re-notifies if it returns later
  for (const id of [...notified]) if (!present.has(id)) notified.delete(id);

  if (!primed) {
    // first run: treat everything currently active as already-known
    primed = true;
    for (const id of present) notified.add(id);
    return;
  }

  if (!opts.enabled || !Notification.isSupported()) {
    // still track ids so toggling notifications back on doesn't re-flood
    for (const id of present) notified.add(id);
    return;
  }

  const min = SEV_RANK[opts.minSeverity];
  for (const a of active) {
    if (notified.has(a.id)) continue;
    notified.add(a.id);
    if (SEV_RANK[a.severity] < min) continue;
    const tag = catLabel(a.category);
    const n = new Notification({
      title: `${a.severity === "critical" ? "⛔" : "⚠"} ${tag} · ${a.title}`,
      body: a.detail,
      silent: a.severity !== "critical"
    });
    n.on("click", () => onActivate());
    n.show();
  }
}

/* ── session activity notifications ("your agent needs you") ───────── */
const prevActivity = new Map<string, string>();
let primedSessions = false;

export interface SessionNotifyOptions {
  enabled: boolean; // master notify switch
  awaitingEnabled: boolean; // notify when an agent finishes its turn / needs input
  windowActive: boolean; // suppress when you're already looking at the cockpit
}

/**
 * Fire a notification when a session flips working → awaiting — the agent
 * finished its turn and the ball is in your court. The single broadest hook:
 * works for one session or many, and fires while you're away (main polls
 * sessions on its own timer, independent of the window).
 */
export function processSessionActivity(
  sessions: AgentSession[],
  opts: SessionNotifyOptions
): void {
  const present = new Set(sessions.map((s) => s.id));
  for (const id of [...prevActivity.keys()]) if (!present.has(id)) prevActivity.delete(id);

  if (!primedSessions) {
    // seed on first poll so we don't ping for conversations already waiting
    primedSessions = true;
    for (const s of sessions) prevActivity.set(s.id, s.activity);
    return;
  }

  for (const s of sessions) {
    const prev = prevActivity.get(s.id);
    prevActivity.set(s.id, s.activity);
    if (prev !== "working" || s.activity !== "awaiting") continue;
    if (!opts.enabled || !opts.awaitingEnabled) continue;
    if (opts.windowActive) continue; // you're already watching — no need to interrupt
    if (!Notification.isSupported()) continue;
    const n = new Notification({
      title: t("notify.awaiting.title", { project: s.project }),
      body: s.task
        ? t("notify.awaiting.body", { agent: s.agentId, task: s.task })
        : t("notify.awaiting.bodyNoTask", { agent: s.agentId }),
      silent: false
    });
    n.on("click", () => onActivate());
    n.show();
  }
}

/** reset state (e.g. on settings change that should re-evaluate from scratch) */
export function resetNotifyState(): void {
  notified = new Set();
  primed = false;
  prevActivity.clear();
  primedSessions = false;
}
