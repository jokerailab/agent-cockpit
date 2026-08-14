import { useEffect, useState } from "react";
import type { MonitorSnapshot } from "@shared/monitor";
import type { AccountQuota, AgentSession, SpendSummary } from "@shared/sessions";
import type { DetectedAgent } from "@shared/agents";
import { t, setLocale, resolveLocale } from "@shared/i18n";

const CAT_KEYS = ["context", "quota", "resource", "port", "security", "burn", "health"] as const;
type CatKey = (typeof CAT_KEYS)[number];
const catLabel = (c: string): string =>
  (CAT_KEYS as readonly string[]).includes(c) ? t(`alert.cat.${c as CatKey}`) : c;

const ACTIVITY_KEYS = ["working", "awaiting", "idle"] as const;
type ActivityKey = (typeof ACTIVITY_KEYS)[number];
const activityLabel = (a: string): string =>
  (ACTIVITY_KEYS as readonly string[]).includes(a) ? t(`activity.${a as ActivityKey}`) : a;

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

const ACCENT: Record<string, string> = {
  claude: "--agent-claude",
  codex: "--agent-codex",
  gemini: "--agent-gemini",
  cursor: "--agent-unknown"
};

function fmtReset(epochSec: number | null): string {
  if (!epochSec) return "";
  const ms = epochSec * 1000 - Date.now();
  if (ms <= 0) return "";
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** how long a session has been waiting on you (since its last write) */
function fmtWait(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!(ms > 0)) return t("time.justNow");
  const m = Math.floor(ms / 60000);
  if (m < 1) return t("time.justNow");
  if (m < 60) return t("time.minutes", { m });
  const h = Math.floor(m / 60);
  return t("time.hoursMinutes", { h, m: m % 60 });
}

export function Popover(): React.JSX.Element {
  const [mon, setMon] = useState<MonitorSnapshot | null>(null);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [quotas, setQuotas] = useState<AccountQuota[]>([]);
  const [agents, setAgents] = useState<DetectedAgent[]>([]);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [armed, setArmed] = useState(false);
  // bumped after the locale is adopted, purely to force a repaint
  const [, setLocaleTick] = useState(0);

  // the popover is its own renderer process, so it resolves the locale itself.
  // Re-synced whenever it becomes visible: the language may have changed in the
  // settings window while this one was hidden.
  useEffect(() => {
    const syncLocale = (): void => {
      if (document.hidden) return;
      void window.cockpit.getSettings().then((s) => {
        setLocale(resolveLocale(s.locale, navigator.language));
        setLocaleTick((n) => n + 1);
      });
    };
    syncLocale();
    document.addEventListener("visibilitychange", syncLocale);
    return () => document.removeEventListener("visibilitychange", syncLocale);
  }, []);

  useEffect(() => window.cockpit.onMonitorTick(setMon), []);
  useEffect(() => {
    const pull = (): void => {
      if (document.hidden) return; // popover is hidden most of the time — don't poll
      void window.cockpit.scanSessions().then((r) => {
        setSessions(r.sessions);
        setQuotas(r.quotas);
      });
      void window.cockpit.getSpend().then(setSpend);
    };
    const onVis = (): void => {
      if (!document.hidden) {
        void window.cockpit.scanAgents().then((r) => setAgents(r.agents));
        pull();
      }
    };
    onVis(); // initial (if visible)
    const id = window.setInterval(pull, 5000);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const totals = mon?.totals;
  const runtimeAgents = (mon?.agents ?? []).filter((a) => a.procCount > 0);
  // review queue: everything waiting on you, longest-waiting first
  const awaiting = sessions
    .filter((s) => s.activity === "awaiting")
    .sort(
      (a, b) =>
        (Date.parse(a.lastActiveAt ?? "") || Infinity) -
        (Date.parse(b.lastActiveAt ?? "") || Infinity)
    );
  const working = sessions.filter((s) => s.activity === "working");
  const orphanPids = [...new Set((mon?.ports ?? []).filter((p) => p.orphan).map((p) => p.pid))];
  const cleanOrphans = (): void => {
    if (!armed) {
      setArmed(true);
      window.setTimeout(() => setArmed(false), 3000);
      return;
    }
    for (const pid of orphanPids) void window.cockpit.monitorAction("killTree", pid);
    setArmed(false);
  };
  const nameOf = (id: string): string => agents.find((a) => a.id === id)?.name ?? id;
  const accentOf = (id: string): string =>
    agents.find((a) => a.id === id)?.accent ?? ACCENT[id] ?? "--agent-unknown";
  const sessCount = (id: string): number => sessions.filter((s) => s.agentId === id).length;

  return (
    <div className="pop">
      <header className="pop__head">
        <span className="pop__brand">Agent Cockpit</span>
        <button type="button" onClick={() => void window.cockpit.openMain()}>
          {t("pop.openMain")}
        </button>
      </header>

      <div className="pop__totals">
        <span><b>{totals?.procs ?? "—"}</b> {t("pop.procs")}</span>
        <span><b>{totals?.cpu ?? "—"}</b><i>{t("pop.cpu")}</i></span>
        <span><b>{totals?.mem ?? "—"}</b><i>{t("pop.mem")}</i></span>
        <span><b>{totals?.listenPorts ?? "—"}</b> {t("pop.ports")}</span>
        <span className={totals?.alerts ? "is-alert" : ""}>
          <b>{totals?.alerts ?? 0}</b> {t("pop.alerts")}
        </span>
      </div>

      {(sessions.length > 0 || (spend && spend.today.total > 0)) && (
        <div className="pop__convoline">
          <span className="pop__cvbadge pop__cvbadge--working">{t("pop.working", { n: working.length })}</span>
          <span className="pop__cvbadge pop__cvbadge--awaiting">{t("pop.awaiting", { n: awaiting.length })}</span>
          {spend && spend.today.total > 0 && (
            <span className="pop__spend" title={t("pop.todaySpendTitle")}>
              {t("pop.todaySpend", { amount: fmtUsd(spend.today.total) })}
            </span>
          )}
        </div>
      )}

      {awaiting.length > 0 && (
        <>
          <div className="pop__section">
            {t("pop.awaitingSection", { n: awaiting.length })}
            {awaiting[0]?.lastActiveAt && (
              <span className="pop__section-hint">
                {t("pop.longestWait", { wait: fmtWait(awaiting[0].lastActiveAt) })}
              </span>
            )}
          </div>
          {awaiting.slice(0, 6).map((s) => (
            <div
              key={`${s.agentId}:${s.id}`}
              className="pop__await"
              style={{ ["--accent" as string]: `var(${accentOf(s.agentId)})` }}
              title={s.cwd ?? undefined}
            >
              <span className="pop__dot" />
              <span className="pop__aname">{s.project}</span>
              <span className="pop__astat">{s.task ?? activityLabel(s.activity)}</span>
              <span className="pop__await-wait">{fmtWait(s.lastActiveAt)}</span>
            </div>
          ))}
        </>
      )}

      {orphanPids.length > 0 && (
        <button type="button" className={`pop__clean${armed ? " armed" : ""}`} onClick={cleanOrphans}>
          {armed
            ? t("pop.cleanOrphansConfirm", { n: orphanPids.length })
            : t("pop.cleanOrphans", { n: orphanPids.length })}
        </button>
      )}

      {quotas.length > 0 && (
        <div className="pop__quotas">
          {quotas.map((q) => {
            const wins = [
              { l: "5h", w: q.fiveHour },
              { l: "7d", w: q.sevenDay }
            ].filter((x) => x.w && !(x.w.resetsAt && x.w.resetsAt * 1000 < Date.now()));
            if (wins.length === 0) return null;
            return (
              <div key={q.source} className="pop__quota">
                <span className="pop__qname">{q.source}</span>
                {wins.map(({ l, w }) => (
                  <span key={l} className="pop__qwin">
                    {l}
                    <i className={`pop__qbar pop__qbar--${w!.pct >= 80 ? "danger" : w!.pct >= 50 ? "warn" : "ok"}`}>
                      <em style={{ width: `${Math.min(100, w!.pct)}%` }} />
                    </i>
                    {Math.round(w!.pct)}%{fmtReset(w!.resetsAt) ? ` ↻${fmtReset(w!.resetsAt)}` : ""}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="pop__section">{t("pop.activeAgents")}</div>
      {runtimeAgents.length > 0 ? (
        runtimeAgents.map((a) => (
          <div
            key={a.agentId}
            className="pop__agent"
            style={{ ["--accent" as string]: `var(${accentOf(a.agentId)})` }}
          >
            <span className="pop__dot" />
            <span className="pop__aname">{nameOf(a.agentId)}</span>
            <span className="pop__astat">
              {a.procCount}p · {a.totalCpu}% · {sessCount(a.agentId)} {t("pop.sessionsSuffix")}
            </span>
          </div>
        ))
      ) : (
        <div className="pop__empty">{t("pop.noAgents")}</div>
      )}

      {mon && mon.alerts.length > 0 && (
        <>
          <div className="pop__section">{t("pop.alertsSection", { n: mon.alerts.length })}</div>
          {mon.alerts.slice(0, 5).map((al) => (
            <div key={al.id} className={`pop__alert pop__alert--${al.severity}`}>
              <span className="pop__adot" />
              <span className="pop__atitle">{al.title}</span>
              <span className="pop__acat">{catLabel(al.category)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
