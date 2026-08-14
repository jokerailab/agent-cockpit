import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SystemInfo } from "@shared/ipc";
import type { DetectedAgent, DiscoveryResult } from "@shared/agents";
import type { AgentRuntime, MonitorProcess, MonitorSnapshot, MonitorTotals } from "@shared/monitor";
import type {
  AgentSession,
  AccountQuota,
  ClaudeHookStatus,
  SessionAudit,
  SpendSummary
} from "@shared/sessions";
import type { Alert } from "@shared/alerts";
import type { AppSettings, AgentBilling } from "@shared/settings";
import type { StorageScan } from "@shared/storage";
import { t, setLocale, resolveLocale, type I18nKey } from "@shared/i18n";

function fmtBytes(n: number): string {
  if (!n) return "0B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)}${u[i]}`;
}

const POLL_OPTIONS: Array<[number, string]> = [
  [1000, "1s"],
  [2000, "2s"],
  [2500, "2.5s"],
  [5000, "5s"],
  [10000, "10s"]
];

function accelFromEvent(e: React.KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Command");
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = e.key;
  if (!["Meta", "Control", "Alt", "Shift"].includes(k)) {
    parts.push(k.length === 1 ? k.toUpperCase() : k);
  }
  return parts.join("+");
}

function ClaudeHookSection(): React.JSX.Element {
  const [status, setStatus] = useState<ClaudeHookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.cockpit.getClaudeHookStatus().then(setStatus);
  }, []);

  const install = useCallback(() => {
    setBusy(true);
    setMsg(null);
    void window.cockpit
      .installClaudeHook()
      .then((r) => {
        setStatus(r.status);
        if (!r.ok) setMsg(r.error ?? t("hook.err.generic"));
        else if (r.conflict) setMsg(t("hook.msg.conflict"));
        else setMsg(t("hook.msg.installed"));
      })
      .finally(() => setBusy(false));
  }, []);

  const state = !status
    ? "loading"
    : status.hasData
      ? "ok"
      : status.wired === "ours"
        ? "wired"
        : status.wired === "other"
          ? "conflict"
          : "none";
  const STATE_LABEL: Record<string, string> = {
    loading: t("hook.state.loading"),
    ok: t("hook.state.ok"),
    wired: t("hook.state.wired"),
    conflict: t("hook.state.conflict"),
    none: t("hook.state.none")
  };

  return (
    <label className="setrow">
      <span>{t("hook.label")}</span>
      <span className="setrow__shortcut">
        <span className={`hookstate hookstate--${state}`}>{STATE_LABEL[state]}</span>
        {state !== "ok" && (
          <button type="button" onClick={install} disabled={busy || state === "loading"}>
            {busy ? "…" : state === "conflict" ? t("hook.action.rewrite") : t("hook.action.install")}
          </button>
        )}
      </span>
      {msg && <span className="setrow__hint">{msg}</span>}
    </label>
  );
}

function BillingRow({
  id,
  name,
  billing,
  onChange
}: {
  id: string;
  name: string;
  billing?: AgentBilling;
  onChange: (b: AgentBilling) => void;
}): React.JSX.Element {
  const mode = billing?.mode ?? "unknown";
  return (
    <label className="setrow" key={id}>
      <span>{name}</span>
      <span className="setrow__shortcut">
        <select
          value={mode}
          onChange={(e) =>
            onChange({
              mode: e.target.value as AgentBilling["mode"],
              planMonthlyUsd: billing?.planMonthlyUsd
            })
          }
        >
          <option value="unknown">{t("billing.unknown")}</option>
          <option value="api">{t("billing.api")}</option>
          <option value="subscription">{t("billing.subscription")}</option>
        </select>
        {mode === "subscription" && (
          <input
            type="number"
            min={0}
            placeholder={t("billing.planPlaceholder")}
            value={billing?.planMonthlyUsd ?? ""}
            onChange={(e) =>
              onChange({
                mode: "subscription",
                planMonthlyUsd: e.target.value ? Number(e.target.value) : undefined
              })
            }
          />
        )}
      </span>
    </label>
  );
}

function SettingsModal({
  settings,
  onPatch,
  onClose
}: {
  settings: AppSettings;
  onPatch: (p: Partial<AppSettings>) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{t("settings.title")}</h2>
          <button type="button" onClick={onClose}>✕</button>
        </div>

        <div className="modal__sec">{t("settings.sec.collection")}</div>
        <label className="setrow">
          <span>{t("settings.language")}</span>
          <select
            value={settings.locale}
            onChange={(e) => onPatch({ locale: e.target.value as AppSettings["locale"] })}
          >
            <option value="auto">{t("settings.language.auto")}</option>
            <option value="en">English</option>
            {/* i18n-exempt: language names are written in their own language */}
            <option value="zh-CN">简体中文</option>
          </select>
        </label>
        <label className="setrow">
          <span>{t("settings.pollInterval")}</span>
          <select
            value={settings.pollIntervalMs}
            onChange={(e) => onPatch({ pollIntervalMs: Number(e.target.value) })}
          >
            {POLL_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>

        <div className="modal__sec">{t("settings.sec.desktop")}</div>
        <label className="setrow">
          <span>{t("settings.autoLaunch")}</span>
          <input
            type="checkbox"
            checked={settings.autoLaunch}
            onChange={(e) => onPatch({ autoLaunch: e.target.checked })}
          />
        </label>
        <label className="setrow">
          <span>{t("settings.globalShortcut")}</span>
          <span className="setrow__shortcut">
            <input
              readOnly
              value={settings.globalShortcut || t("common.unset")}
              placeholder={t("settings.shortcutPlaceholder")}
              onKeyDown={(e) => {
                e.preventDefault();
                if (e.key === "Escape") return;
                if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
                onPatch({ globalShortcut: accelFromEvent(e) });
              }}
            />
            {settings.globalShortcut && (
              <button type="button" onClick={() => onPatch({ globalShortcut: "" })}>
                {t("common.clear")}
              </button>
            )}
          </span>
        </label>

        <div className="modal__sec">{t("settings.sec.notifications")}</div>
        <label className="setrow">
          <span>{t("settings.notifyEnabled")}</span>
          <input
            type="checkbox"
            checked={settings.notifyEnabled}
            onChange={(e) => onPatch({ notifyEnabled: e.target.checked })}
          />
        </label>
        <label className="setrow">
          <span>{t("settings.notifyLevel")}</span>
          <select
            value={settings.notifyMinSeverity}
            disabled={!settings.notifyEnabled}
            onChange={(e) =>
              onPatch({ notifyMinSeverity: e.target.value as "warn" | "critical" })
            }
          >
            <option value="warn">{t("settings.notifyLevel.warn")}</option>
            <option value="critical">{t("settings.notifyLevel.critical")}</option>
          </select>
        </label>
        <label className="setrow">
          <span>{t("settings.notifyAwaiting")}</span>
          <input
            type="checkbox"
            checked={settings.notifyAwaiting}
            disabled={!settings.notifyEnabled}
            onChange={(e) => onPatch({ notifyAwaiting: e.target.checked })}
          />
        </label>

        <div className="modal__sec">{t("settings.sec.billing")}</div>
        {([["claude", "Claude Code"], ["codex", "Codex"]] as const).map(([id, name]) => (
          <BillingRow
            key={id}
            id={id}
            name={name}
            billing={settings.billing?.[id]}
            onChange={(b) => onPatch({ billing: { ...settings.billing, [id]: b } })}
          />
        ))}

        <div className="modal__sec">{t("settings.sec.integrations")}</div>
        <ClaudeHookSection />

        <div className="modal__sec">{t("settings.sec.thresholds")}</div>
        <label className="setrow">
          <span>{t("settings.contextWarn")}</span>
          <span className="setrow__num">
            <input
              type="number" min={50} max={99}
              value={Math.round(settings.contextWarnPct * 100)}
              onChange={(e) => onPatch({ contextWarnPct: Number(e.target.value) / 100 })}
            />%
          </span>
        </label>
        <label className="setrow">
          <span>{t("settings.quotaWarn")}</span>
          <span className="setrow__num">
            <input type="number" min={50} max={99} value={settings.quotaWarnPct}
              onChange={(e) => onPatch({ quotaWarnPct: Number(e.target.value) })} />%
          </span>
        </label>
        <label className="setrow">
          <span>{t("settings.cpuWarn")}</span>
          <span className="setrow__num">
            <input type="number" min={50} max={100} value={settings.cpuWarnPct}
              onChange={(e) => onPatch({ cpuWarnPct: Number(e.target.value) })} />%
          </span>
        </label>
        <label className="setrow">
          <span>{t("settings.memWarn")}</span>
          <span className="setrow__num">
            <input type="number" min={2} max={90} value={settings.memWarnPct}
              onChange={(e) => onPatch({ memWarnPct: Number(e.target.value) })} />%
          </span>
        </label>
        <label className="setrow">
          <span>{t("settings.burnWarn")}</span>
          <span className="setrow__num">
            $<input type="number" min={1} max={100} value={settings.burnWarnUsdPerMin}
              onChange={(e) => onPatch({ burnWarnUsdPerMin: Number(e.target.value) })} />/min
          </span>
        </label>
      </div>
    </div>
  );
}

const CAT_KEYS = ["context", "quota", "resource", "port", "security", "burn", "health"] as const;
type CatKey = (typeof CAT_KEYS)[number];
const catLabel = (c: string): string =>
  (CAT_KEYS as readonly string[]).includes(c) ? t(`alert.cat.${c as CatKey}`) : c;

function AlertCenter({ alerts }: { alerts: Alert[] }): React.JSX.Element {
  return (
    <div className="alerts">
      {alerts.map((a) => (
        <div key={a.id} className={`alert alert--${a.severity}`}>
          <span className="alert__sev" />
          <span className="alert__cat">{catLabel(a.category)}</span>
          <div className="alert__main">
            <strong>{a.title}</strong>
            <p>{a.detail}</p>
          </div>
          <span className="alert__ago">{fmtAgo(new Date(a.since).toISOString())}</span>
        </div>
      ))}
    </div>
  );
}

const KIND_KEYS = ["cli", "ide", "ide-ext", "framework"] as const;
type KindKey = (typeof KIND_KEYS)[number];
const kindLabel = (k: string): string =>
  (KIND_KEYS as readonly string[]).includes(k) ? t(`agent.kind.${k as KindKey}`) : k;

/** Agents whose session logs we parse for context%/tokens/quota. Others get
 * process-level monitoring only — surfaced honestly in the UI. */
const SESSION_AGENTS = new Set(["claude", "codex"]);

function fmtElapsed(sec: number): string {
  if (sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  const s = sec % 60;
  return `${m}m${String(s).padStart(2, "0")}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return t("time.ago", { v: `${s}s` });
  const m = Math.round(s / 60);
  if (m < 60) return t("time.ago", { v: `${m}m` });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.ago", { v: `${h}h` });
  return t("time.ago", { v: `${Math.round(h / 24)}d` });
}

function fmtLimit(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`;
}

function fmtReset(epochSec: number | null): string {
  if (!epochSec) return "";
  const ms = epochSec * 1000 - Date.now();
  if (ms <= 0) return t("time.resetting");
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${String(m % 60).padStart(2, "0")}`;
}

const ACTIVITY_KEYS = ["working", "awaiting", "idle"] as const;
type ActivityKey = (typeof ACTIVITY_KEYS)[number];
const activityLabel = (a: string): string =>
  (ACTIVITY_KEYS as readonly string[]).includes(a) ? t(`activity.${a as ActivityKey}`) : a;
// awaiting first — those are the ones waiting on YOU; then working, then parked
const ACTIVITY_ORDER: Record<string, number> = { awaiting: 0, working: 1, idle: 2 };

/** one-line "how to handle this" suggestion for a flagged session */
/**
 * Actionable advice for a diagnosed session.
 *
 * Branches on `healthDiagKey`, NOT on the rendered `healthDiag` text — the
 * latter is localised, so substring matching against it silently collapses to
 * the fallback under any non-Chinese locale.
 */
function handleAdvice(a: SessionAudit): string {
  if (a.healthStatus === "healthy") return "";
  switch (a.healthDiagKey) {
    case "degenerate":
    case "spinningBad":
    case "spinning":
      return t("health.advice.unsalvageable");
    case "contextBlown":
      return t("health.advice.contextBlown");
    case "contextTight":
      return t("health.advice.contextTight");
    case "stalled":
      return t("health.advice.stalled");
    case "errorProne":
      return t("health.advice.errorProne");
    default:
      return a.healthStatus === "failing"
        ? t("health.advice.failing")
        : t("health.advice.degrading");
  }
}

function HealthAudit({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element | null {
  const [rows, setRows] = useState<SessionAudit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [onlyBad, setOnlyBad] = useState(true);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    setLoading(true);
    void window.cockpit
      .auditSessions()
      .then(setRows)
      .finally(() => setLoading(false));
  }, [open]);
  if (!open) return null;
  const all = rows ?? [];
  const badCount = all.filter((r) => r.healthStatus !== "healthy").length;
  const shown = onlyBad ? all.filter((r) => r.healthStatus !== "healthy") : all;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__panel modal__panel--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>{t("audit.title")}</h2>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="audit__lead">
          {t("audit.lead")}
          {rows ? t("audit.leadCount", { total: all.length, bad: badCount }) : ""}
        </p>
        <label className="audit__filter">
          <input
            type="checkbox"
            checked={onlyBad}
            onChange={(e) => setOnlyBad(e.target.checked)}
          />
          {t("audit.onlyBad")}
        </label>
        {loading && <div className="audit__empty">{t("audit.scanning")}</div>}
        {rows && shown.length === 0 && <div className="audit__empty">{t("audit.empty")}</div>}
        <div className="audit__list">
          {shown.map((r) => {
            const advice = handleAdvice(r);
            return (
              <div key={r.id} className={`audit__row audit__row--${r.healthStatus}`}>
                <span className="audit__score">{r.healthScore}</span>
                <div className="audit__mid">
                  <div className="audit__proj">
                    {r.activity === "working" && <span className="audit__live">{t("audit.live")}</span>}
                    {r.project} <em>{r.agentId}</em>
                  </div>
                  <div className="audit__diag">{r.healthDiag ?? t("health.diag.healthy")}</div>
                  {advice && <div className="audit__advice">{t("audit.advice", { text: advice })}</div>}
                </div>
                <div className="audit__meta">
                  <span>{fmtBytes(r.sizeBytes)}</span>
                  <span>{t("common.turns", { n: r.turnCount })}</span>
                  <span>CTX {Math.round(r.contextPct * 100)}%</span>
                  <span>{fmtAgo(r.lastActiveAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ s, accent }: { s: AgentSession; accent: string }): React.JSX.Element {
  const pct = Math.round(s.contextPct * 100);
  const level = s.contextPct >= 0.8 ? "danger" : s.contextPct >= 0.6 ? "warn" : "ok";
  const [store, setStore] = useState<StorageScan | null>(null);
  const [storing, setStoring] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);

  const scanStore = (): void => {
    if (!s.cwd) return;
    setStoreOpen((o) => !o);
    if (store || storing) return;
    setStoring(true);
    void window.cockpit
      .scanStorage(s.cwd)
      .then(setStore)
      .finally(() => setStoring(false));
  };
  const storeMax = store ? Math.max(1, ...store.items.map((i) => i.bytes)) : 1;
  return (
    <article className={`sess sess--${s.activity}`} style={{ ["--accent" as string]: `var(${accent})` }}>
      <div className="sess__top">
        <span className="sess__dot" title={activityLabel(s.activity)} />
        <span className="sess__proj">{s.project}</span>
        <span className={`sess__act sess__act--${s.activity}`}>{activityLabel(s.activity)}</span>
        <span className="sess__agent">{s.agentId}</span>
        {s.gitBranch && (
          <span className="sess__git">
            ⎇ {s.gitBranch}
            {s.gitDirty ? <em>+{s.gitDirty}</em> : null}
          </span>
        )}
      </div>
      {s.healthStatus !== "healthy" && (
        <div className={`sess__health sess__health--${s.healthStatus}`} title={t("session.healthTitle")}>
          <b>{s.healthScore}</b>
          <span>
            {s.healthStatus === "failing" ? t("session.degraded") : t("session.borderline")} ·{" "}
            {s.healthDiag}
          </span>
          <em>
            {s.healthStatus === "failing"
              ? t("session.actionRestart")
              : t("session.actionWatch")}
          </em>
        </div>
      )}
      {s.task && <p className="sess__task">{s.task}</p>}
      <div className={`sess__bar sess__bar--${level}`}>
        <span style={{ width: `${pct}%` }} />
        {s.compactionRisk && <i className="sess__warn">{t("session.compactionNear")}</i>}
      </div>
      <div className="sess__ctxline">
        CTX <b>{pct}%</b> · {fmtTokens(s.contextTokens)}/{fmtLimit(s.contextLimit)}
        {s.tokenRate > 0 && <span className="sess__rate">{fmtTokens(s.tokenRate)}/min</span>}
        {s.activity === "working" && s.costRate >= 1 && (
          <span className="sess__burn" title={t("session.burnTitle")}>
            🔥 ${s.costRate.toFixed(1)}/min
          </span>
        )}
      </div>
      <TokenBar s={s} />
      <div className="sess__foot2">
        {s.turnCount > 0 && <span title="turns">↻ {s.turnCount} turns</span>}
        <span>Σ {fmtTokens(s.totalTokens)}</span>
        {s.costUsd != null && (
          <span className="sess__cost" title={t("session.costTitle")}>
            ≈{fmtUsd(s.costUsd)}
          </span>
        )}
        {s.cwd && (
          <button type="button" className="sess__disk" onClick={scanStore}>
            {storing
              ? t("common.scanning")
              : store
                ? t("session.projectSize", { size: fmtBytes(store.totalBytes) })
                : t("session.projectSizeIdle")}
            <i>{storeOpen ? "▾" : "▸"}</i>
          </button>
        )}
        <span className="sess__ago">{fmtAgo(s.lastActiveAt)}</span>
      </div>
      {storeOpen && store && !store.error && (
        <div className="disk">
          {store.items.length === 0 && <div className="disk__empty">{t("session.diskEmpty")}</div>}
          {store.items.map((it) => (
            <div key={it.name} className="disk__row">
              <span className="disk__name" title={it.name}>
                {it.kind === "dir" ? "📁" : "📄"} {it.name}
              </span>
              <span className="disk__bar">
                <i style={{ width: `${(it.bytes / storeMax) * 100}%` }} />
              </span>
              <span className="disk__sz">{fmtBytes(it.bytes)}</span>
            </div>
          ))}
        </div>
      )}
      {storeOpen && store?.error && (
        <div className="disk__empty">{t("session.diskError", { error: store.error })}</div>
      )}
    </article>
  );
}

function fmtAgoSec(epochSec: number | null): string {
  if (!epochSec) return "";
  return fmtAgo(new Date(epochSec * 1000).toISOString());
}

/** Tiny CPU sparkline from a rolling series. */
function Sparkline({ data, accent }: { data: number[]; accent: string }): React.JSX.Element {
  const w = 100;
  const h = 28;
  const max = Math.max(1, ...data);
  const pts = data.length
    ? data
        .map((v, i) => {
          const x = data.length === 1 ? w : (i / (data.length - 1)) * w;
          const y = h - (v / max) * (h - 3) - 1.5;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ")
    : `0,${h} ${w},${h}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={`0,${h} ${pts} ${w},${h}`}
        fill={`var(${accent})`}
        fillOpacity="0.1"
        stroke="none"
      />
      <polyline points={pts} fill="none" stroke={`var(${accent})`} strokeWidth="1.5" />
    </svg>
  );
}

const STAT_CELLS: Array<{ key: keyof MonitorTotals; labelKey: I18nKey; unit: string }> = [
  { key: "procs", labelKey: "stat.procs", unit: "" },
  { key: "cpu", labelKey: "stat.cpu", unit: "%" },
  { key: "mem", labelKey: "stat.mem", unit: "%" },
  { key: "listenPorts", labelKey: "stat.ports", unit: "" },
  { key: "alerts", labelKey: "stat.alerts", unit: "" }
];

function StatStrip({
  totals,
  hist
}: {
  totals: MonitorTotals | null;
  hist: MonitorTotals[];
}): React.JSX.Element {
  return (
    <div className="strip">
      {STAT_CELLS.map((c) => {
        const v = totals ? totals[c.key] : null;
        const data = hist.map((h) => h[c.key]);
        const accent = c.key === "alerts" && v ? "--danger" : "--signal";
        return (
          <div className="stat" key={c.key}>
            <div className="stat__top">
              <span className="stat__label">{t(c.labelKey)}</span>
              <span className="stat__val">
                {v === null ? "—" : v}
                {c.unit && <i>{c.unit}</i>}
              </span>
            </div>
            <Sparkline data={data} accent={accent} />
          </div>
        );
      })}
    </div>
  );
}

/** Spend rollup strip — today/week/month equivalent cost + subscription ROI. */
function SpendStrip({
  spend,
  settings,
  agentById
}: {
  spend: SpendSummary | null;
  settings: AppSettings | null;
  agentById: Map<string, DetectedAgent>;
}): React.JSX.Element | null {
  if (!spend || spend.all.total <= 0) return null;
  const billing = settings?.billing ?? {};
  const roi: Array<{ name: string; mult: number; spent: number; plan: number }> = [];
  for (const [id, b] of Object.entries(billing)) {
    if (b.mode === "subscription" && b.planMonthlyUsd && b.planMonthlyUsd > 0) {
      const spent = spend.month.byAgent[id] ?? 0;
      roi.push({
        name: agentById.get(id)?.name ?? id,
        mult: spent / b.planMonthlyUsd,
        spent,
        plan: b.planMonthlyUsd
      });
    }
  }
  return (
    <div className="spend">
      <div className="spend__cell">
        <span>{t("spend.today")}</span>
        <b>≈{fmtUsd(spend.today.total)}</b>
      </div>
      <div className="spend__cell">
        <span>{t("spend.week")}</span>
        <b>≈{fmtUsd(spend.week.total)}</b>
      </div>
      <div className="spend__cell">
        <span>{t("spend.month")}</span>
        <b>≈{fmtUsd(spend.month.total)}</b>
      </div>
      {roi.map((r) => (
        <div
          className="spend__roi"
          key={r.name}
          title={t("spend.paybackTitle", { spent: fmtUsd(r.spent), plan: fmtUsd(r.plan) })}
        >
          <span>{t("spend.payback", { name: r.name })}</span>
          <b className={r.mult >= 1 ? "is-win" : ""}>{r.mult.toFixed(1)}×</b>
        </div>
      ))}
      <span className="spend__note">{t("spend.note")}</span>
    </div>
  );
}

/** Segmented token-composition bar: cache-read / cache-write / input / output. */
function TokenBar({ s }: { s: AgentSession }): React.JSX.Element {
  const segs = [
    { k: "cacheRead", label: "cache R", v: s.cacheRead, c: "--tok-cacher" },
    { k: "cacheCreate", label: "cache W", v: s.cacheCreate, c: "--tok-cachew" },
    { k: "input", label: "in", v: s.inputTokens, c: "--tok-in" },
    { k: "output", label: "out", v: s.outputTokens, c: "--tok-out" }
  ].filter((x) => x.v > 0);
  const total = segs.reduce((a, b) => a + b.v, 0) || 1;
  return (
    <div className="tok">
      <div className="tok__bar">
        {segs.map((seg) => (
          <span
            key={seg.k}
            style={{ width: `${(seg.v / total) * 100}%`, background: `var(${seg.c})` }}
            title={`${seg.label} ${fmtTokens(seg.v)}`}
          />
        ))}
      </div>
      <div className="tok__legend">
        {segs.map((seg) => (
          <span key={seg.k}>
            <i style={{ background: `var(${seg.c})` }} />
            {seg.label} <b>{fmtTokens(seg.v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function RuntimeSummary({
  rt,
  agent
}: {
  rt: AgentRuntime;
  agent: DetectedAgent | undefined;
}): React.JSX.Element {
  const accent = agent?.accent ?? "--agent-unknown";
  return (
    <article className="rt-card" style={{ ["--accent" as string]: `var(${accent})` }}>
      <div className="rt-card__top">
        <span className="rt-card__name">{agent?.name ?? rt.agentId}</span>
        <span className="rt-card__proc">×{rt.rootCount} · {rt.procCount}p</span>
      </div>
      <Sparkline data={rt.series.map((s) => s.cpu)} accent={accent} />
      <div className="rt-card__grid">
        <span>CPU <b>{rt.totalCpu}%</b></span>
        <span>MEM <b>{rt.totalMem}%</b></span>
        <span>PORT <b>{rt.listenPorts}</b></span>
        <span>UP <b>{fmtElapsed(rt.longestElapsedSec)}</b></span>
      </div>
    </article>
  );
}

interface ProcRowProps {
  p: MonitorProcess;
  agent: DetectedAgent | undefined;
  busy: boolean;
  killArmed: boolean;
  treeArmed: boolean;
  hot: boolean;
  onKill: (action: "killPid" | "killTree", pid: number) => void;
  onHover: (agentId: string | null) => void;
}

const ProcRow = memo(function ProcRow({
  p,
  agent,
  busy,
  killArmed,
  treeArmed,
  hot,
  onKill,
  onHover
}: ProcRowProps): React.JSX.Element {
  const accent = agent?.accent ?? "--agent-unknown";
  return (
    <div
      className={`proc${hot ? " is-hot" : ""}`}
      style={{ paddingLeft: `${p.depth * 18}px` }}
      onMouseEnter={() => onHover(p.agentId)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="proc__dot" style={{ background: `var(${accent})` }} />
      <span className="proc__pid">{p.pid}</span>
      <code className="proc__cmd">{p.command}</code>
      <span className="proc__stat">{p.cpu}%</span>
      <span className="proc__stat">{p.mem}%</span>
      <span className="proc__stat proc__up">{fmtElapsed(p.elapsedSec)}</span>
      <span className="proc__actions">
        {p.isRoot && (
          <button
            type="button"
            className={treeArmed ? "armed" : ""}
            disabled={busy}
            onClick={() => onKill("killTree", p.pid)}
          >
            {treeArmed ? t("common.confirm") : t("deck.killTree")}
          </button>
        )}
        <button
          type="button"
          className={killArmed ? "armed" : "quiet"}
          disabled={busy}
          onClick={() => onKill("killPid", p.pid)}
        >
          {killArmed ? t("common.confirm") : t("deck.kill")}
        </button>
      </span>
    </div>
  );
},
// skip re-render when nothing the row shows changed. cpu/mem move every tick for
// busy procs (they re-render anyway); idle rows stay static. uptime compared at
// minute granularity so idle rows refresh at most once/min instead of every tick.
(a, b) =>
  a.p.pid === b.p.pid &&
  a.p.command === b.p.command &&
  a.p.cpu === b.p.cpu &&
  a.p.mem === b.p.mem &&
  a.p.depth === b.p.depth &&
  a.p.isRoot === b.p.isRoot &&
  Math.floor(a.p.elapsedSec / 60) === Math.floor(b.p.elapsedSec / 60) &&
  a.agent === b.agent &&
  a.busy === b.busy &&
  a.killArmed === b.killArmed &&
  a.treeArmed === b.treeArmed &&
  a.hot === b.hot);

function IdMark(): React.JSX.Element {
  return (
    <svg className="id__mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="24" cy="24" r="14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 4" />
      <circle cx="24" cy="24" r="3" fill="currentColor" />
      <line x1="24" y1="2" x2="24" y2="10" stroke="currentColor" strokeWidth="1.4" />
      <line x1="24" y1="38" x2="24" y2="46" stroke="currentColor" strokeWidth="1.4" />
      <line x1="2" y1="24" x2="10" y2="24" stroke="currentColor" strokeWidth="1.4" />
      <line x1="38" y1="24" x2="46" y2="24" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RadarSweep(): React.JSX.Element {
  return (
    <svg className="sweep" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <radialGradient id="rg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--signal-wash)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <linearGradient id="hand" x1="50%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%" stopColor="var(--signal)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--signal)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="url(#rg)" />
      {[30, 58, 86].map((rr) => (
        <circle key={rr} cx="100" cy="100" r={rr} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      <line x1="4" y1="100" x2="196" y2="100" stroke="var(--line)" strokeWidth="1" />
      <line x1="100" y1="4" x2="100" y2="196" stroke="var(--line)" strokeWidth="1" />
      <g className="sweep__hand">
        <path d="M100 100 L196 100 A96 96 0 0 0 168 32 Z" fill="url(#hand)" />
        <line x1="100" y1="100" x2="196" y2="100" stroke="var(--signal)" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

function QuotaBars({ quota }: { quota: AccountQuota }): React.JSX.Element | null {
  const now = Date.now();
  const win = (label: string, w: { pct: number; resetsAt: number | null } | null): React.JSX.Element | null => {
    if (!w) return null;
    if (w.resetsAt && w.resetsAt * 1000 < now) return null;
    const lvl = w.pct >= 80 ? "danger" : w.pct >= 50 ? "warn" : "ok";
    const reset = fmtReset(w.resetsAt);
    return (
      <div className="qbar" key={label}>
        <span className="qbar__lbl">{label}</span>
        <div className={`qbar__track qbar__track--${lvl}`}>
          <span style={{ width: `${Math.min(100, w.pct)}%` }} />
        </div>
        <span className="qbar__pct">{Math.round(w.pct)}%</span>
        {reset && <span className="qbar__reset">↻{reset}</span>}
      </div>
    );
  };
  const bars = [win("5h", quota.fiveHour), win("7d", quota.sevenDay)].filter(Boolean);
  if (bars.length === 0) return null;
  const stale = quota.updatedAt ? now - quota.updatedAt * 1000 > 60 * 60 * 1000 : false;
  return (
    <div className="agent-card__quota">
      {bars}
      {stale && <span className="qbar__age">{fmtAgoSec(quota.updatedAt)}</span>}
    </div>
  );
}

function CostLine({
  sessions,
  billing
}: {
  sessions: AgentSession[];
  billing?: AgentBilling;
}): React.JSX.Element | null {
  const costs = sessions.map((s) => s.costUsd).filter((c): c is number => c != null);
  if (costs.length === 0) return null;
  const sum = costs.reduce((a, b) => a + b, 0);
  const mode = billing?.mode ?? "unknown";
  const plan = billing?.planMonthlyUsd;
  return (
    <div className={`aagent__cost aagent__cost--${mode}`}>
      {mode === "api" ? (
        <>
          <b>{fmtUsd(sum)}</b> <span>{t("cost.actual")}</span>
        </>
      ) : mode === "subscription" ? (
        <>
          <b>≈{fmtUsd(sum)}</b> <span>{t("cost.equivalent")}</span>
          {plan ? (
            <em>{t("cost.planLine", { plan: fmtUsd(plan) })}</em>
          ) : (
            <em>{t("cost.planIncluded")}</em>
          )}
        </>
      ) : (
        <>
          <b>≈{fmtUsd(sum)}</b> <span>{t("cost.estimated")}</span>
          <em>{t("cost.atPublishedRates")}</em>
        </>
      )}
    </div>
  );
}

function ActiveAgentCard({
  agent,
  runtime,
  sessions,
  quota,
  billing,
  onConfigureQuota
}: {
  agent: DetectedAgent;
  runtime: AgentRuntime | undefined;
  sessions: AgentSession[];
  quota?: AccountQuota;
  billing?: AgentBilling;
  onConfigureQuota?: () => void;
}): React.JSX.Element {
  const awaitingCount = sessions.filter((s) => s.activity === "awaiting").length;
  return (
    <article className="aagent" style={{ ["--accent" as string]: `var(${agent.accent})` }}>
      <span className="aagent__bar" />
      <div className="aagent__body">
        <div className="aagent__side">
          <div className="aagent__head">
            <span className="sess__status sess__status--active" />
            <h3>{agent.name}</h3>
            {agent.version && <span className="aagent__ver">v{agent.version}</span>}
            {awaitingCount > 0 && (
              <span className="aagent__await" title={t("session.awaitingTitle", { n: awaitingCount })}>
                {t("session.awaitingCount", { n: awaitingCount })}
              </span>
            )}
          </div>
          <div className="aagent__vendor">
            {agent.vendor} · {kindLabel(agent.kind)}
          </div>
          <div className="aagent__stats">
            {runtime && (
              <>
                <span>
                  <b>{runtime.procCount}</b> proc
                </span>
                <span>
                  <b>{runtime.totalCpu}%</b> CPU
                </span>
                {runtime.listenPorts > 0 && (
                  <span>
                    <b>{runtime.listenPorts}</b> port
                  </span>
                )}
              </>
            )}
            <span>
              <b>{sessions.length}</b> {t("common.sessions")}
            </span>
          </div>
          <CostLine sessions={sessions} billing={billing} />
          {runtime && runtime.series.length > 1 && (
            <Sparkline data={runtime.series.map((s) => s.cpu)} accent={agent.accent} />
          )}
          {quota && <QuotaBars quota={quota} />}
          {!quota && agent.id === "claude" && (
            <button type="button" className="quota-setup" onClick={onConfigureQuota}>
              {t("deck.quotaSetup")}
            </button>
          )}
        </div>
        <div className="aagent__sessions">
          {sessions.length > 0 ? (
            sessions.map((s) => <SessionCard key={s.id} s={s} accent={agent.accent} />)
          ) : SESSION_AGENTS.has(agent.id) ? (
            <div className="aagent__nosess">{t("session.noneActive")}</div>
          ) : (
            <div className="aagent__nosess aagent__nosess--proc">
              {t("session.noIntrospection")}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function IdleChip({ agent }: { agent: DetectedAgent }): React.JSX.Element {
  return (
    <span className="ichip" style={{ ["--accent" as string]: `var(${agent.accent})` }}>
      <i />
      {agent.name}
      {agent.version && <em>v{agent.version}</em>}
    </span>
  );
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null);
  const [scanning, setScanning] = useState(true);
  const [monitor, setMonitor] = useState<MonitorSnapshot | null>(null);
  const [totalsHist, setTotalsHist] = useState<MonitorTotals[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [quotas, setQuotas] = useState<AccountQuota[]>([]);
  const [running, setRunning] = useState(true);
  const [actionPid, setActionPid] = useState<number | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [hlAgent, setHlAgent] = useState<string | null>(null);
  const [procFilter, setProcFilter] = useState("");
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  // tracks the pending "disarm" timeout for the two-step kill/clean confirms
  const armedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (armedTimer.current) window.clearTimeout(armedTimer.current);
  }, []);

  useEffect(() => {
    const pull = (): void => {
      if (document.hidden) return;
      void window.cockpit.getSpend().then(setSpend);
    };
    pull();
    const id = window.setInterval(pull, 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void window.cockpit.getSystemInfo().then(setInfo);
  }, []);

  // seed sparklines from persisted history so trends survive restarts
  useEffect(() => {
    void window.cockpit.getHistory().then((rows) => {
      if (rows.length) setTotalsHist((h) => (h.length ? h : rows.slice(-40)));
    });
  }, []);

  useEffect(() => {
    const off = window.cockpit.onMonitorTick((snap) => {
      setMonitor(snap);
      setTotalsHist((h) => [...h.slice(-39), snap.totals]);
    });
    return off;
  }, []);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const pull = () => {
      if (document.hidden) return; // skip work when window is hidden in tray
      void window.cockpit.scanSessions().then((r) => {
        if (alive) {
          setSessions(r.sessions);
          setQuotas(r.quotas);
        }
      });
    };
    pull();
    const id = window.setInterval(pull, 5000);
    const onVis = (): void => {
      if (!document.hidden) pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  /**
   * Adopt settings and the locale together. `setLocale` mutates module state
   * that React cannot observe, so it must run BEFORE the setState that triggers
   * the re-render — otherwise the tree repaints with the previous language.
   */
  const adoptSettings = useCallback((s: AppSettings) => {
    setLocale(resolveLocale(s.locale, navigator.language));
    setSettings(s);
  }, []);

  useEffect(() => {
    void window.cockpit.getSettings().then(adoptSettings);
  }, [adoptSettings]);

  const patchSettings = useCallback(
    (p: Partial<AppSettings>) => {
      void window.cockpit.setSettings(p).then(adoptSettings);
    },
    [adoptSettings]
  );

  const toggleRunning = useCallback(() => {
    setRunning((r) => {
      const next = !r;
      void window.cockpit.monitorControl({ running: next });
      return next;
    });
  }, []);

  // two-step: first click arms, second click within 3s executes
  // arm a key for 3s; clears any prior pending disarm timer (tracked in a ref so
  // it's cancelled on unmount instead of firing setState on a dead component)
  const armFor = useCallback((key: string) => {
    if (armedTimer.current) window.clearTimeout(armedTimer.current);
    armedTimer.current = window.setTimeout(() => {
      setArmed((c) => (c === key ? null : c));
      armedTimer.current = null;
    }, 3000);
  }, []);

  const killProc = useCallback(
    (action: "killPid" | "killTree", pid: number) => {
      const key = `${action}:${pid}`;
      setArmed((cur) => {
        if (cur === key) {
          setActionPid(pid);
          void window.cockpit.monitorAction(action, pid).finally(() => setActionPid(null));
          return null;
        }
        armFor(key);
        return key;
      });
    },
    [armFor]
  );

  // two-step bulk cleanup of orphan dev-server processes (kill tree each)
  const cleanOrphans = useCallback(
    (pids: number[]) => {
      setArmed((cur) => {
        if (cur === "orphans") {
          for (const pid of pids) void window.cockpit.monitorAction("killTree", pid);
          return null;
        }
        armFor("orphans");
        return "orphans";
      });
    },
    [armFor]
  );

  const runScan = useCallback(() => {
    setScanning(true);
    void window.cockpit
      .scanAgents()
      .then(setDiscovery)
      .finally(() => setScanning(false));
  }, []);

  useEffect(() => {
    runScan();
  }, [runScan]);

  useEffect(() => {
    return window.cockpit.onMenuEvent((event) => {
      if (event === "rescan") runScan();
      else if (event === "toggle-monitor") toggleRunning();
      else if (event === "open-settings") setSettingsOpen(true);
    });
  }, [runScan, toggleRunning]);

  const derived = useMemo(() => {
    const agents = discovery?.agents ?? [];
    const agentById = new Map(agents.map((a) => [a.id, a]));
    const runtimeById = new Map((monitor?.agents ?? []).map((r) => [r.agentId, r]));
    const sessionsByAgent = new Map<string, AgentSession[]>();
    for (const s of sessions) {
      const arr = sessionsByAgent.get(s.agentId);
      if (arr) arr.push(s);
      else sessionsByAgent.set(s.agentId, [s]);
    }
    // surface the conversations that need attention first (awaiting → working → idle)
    for (const arr of sessionsByAgent.values()) {
      arr.sort(
        (a, b) =>
          ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity] ||
          (b.lastActiveAt || "").localeCompare(a.lastActiveAt || "")
      );
    }
    const runtimeAgents = (monitor?.agents ?? []).filter((a) => a.procCount > 0);
    const idleAgents = monitor
      ? agents.filter((a) => !runtimeAgents.some((r) => r.agentId === a.id))
      : [];
    const quotaBySource = new Map(quotas.map((q) => [q.source, q]));
    const activeFleet: DetectedAgent[] = [];
    const idleFleet: DetectedAgent[] = [];
    for (const a of agents) {
      const isActive =
        (runtimeById.get(a.id)?.procCount ?? 0) > 0 ||
        (sessionsByAgent.get(a.id)?.length ?? 0) > 0;
      (isActive ? activeFleet : idleFleet).push(a);
    }
    const listenPorts = (monitor?.ports ?? []).filter((p) => p.state === "LISTEN");
    return {
      agents, agentById, runtimeById, sessionsByAgent,
      runtimeAgents, idleAgents, quotaBySource, activeFleet, idleFleet, listenPorts
    };
  }, [discovery, monitor, sessions, quotas]);
  const {
    agents, agentById, runtimeById, sessionsByAgent,
    runtimeAgents, idleAgents, quotaBySource, activeFleet, idleFleet, listenPorts
  } = derived;
  const awaitingNow = sessions.filter((s) => s.activity === "awaiting").length;

  const filteredProcs = useMemo(() => {
    const procs = monitor?.processes ?? [];
    const q = procFilter.trim().toLowerCase();
    if (!q) return procs;
    return procs.filter(
      (p) =>
        p.command.toLowerCase().includes(q) ||
        String(p.pid).includes(q) ||
        (agentById.get(p.agentId)?.name ?? p.agentId).toLowerCase().includes(q)
    );
  }, [monitor, procFilter, agentById]);

  return (
    <div className="deck">
      <div className="deck__grain" />
      <div className="deck__frame">
        <span className="reg reg--tl" />
        <span className="reg reg--tr" />
        <span className="reg reg--bl" />
        <span className="reg reg--br" />
      </div>

      <header className="masthead fade-seq d1">
        <div className="id">
          <IdMark />
          <div className="id__title">
            <h1>
              Agent <em>Cockpit</em>
            </h1>
            <p className="id__sub">{t("deck.subtitle")}</p>
          </div>
        </div>
        <dl className="telemetry">
          <div>
            <dt>Host</dt>
            <dd>{info?.hostname ?? "····"}</dd>
          </div>
          <div>
            <dt>Platform</dt>
            <dd>{info ? `${info.platformLabel} · ${info.arch}` : "····"}</dd>
          </div>
          <div>
            <dt>Build</dt>
            <dd>v{info?.appVersion ?? "0.0.0"}</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd className="live">{scanning ? "SCAN" : String(agents.length)}</dd>
          </div>
          <div>
            <dt>{t("deck.telemetry.awaiting")}</dt>
            <dd className={awaitingNow > 0 ? "tel-await" : ""}>{awaitingNow}</dd>
          </div>
        </dl>
        <button type="button" className="gear" title={t("deck.audit")} onClick={() => setAuditOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
              strokeLinecap="round"
              d="M2 13h4l2.5 6 4-14 2.5 8 1.5-3H22"
            />
          </svg>
        </button>
        <button type="button" className="gear" title={t("deck.settings")} onClick={() => setSettingsOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5a8 8 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8 8 0 0 0-2-1.2l-.4-2.6H10.9l-.4 2.6a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8 8 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.4 2.6h4.2l.4-2.6a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A8 8 0 0 0 20 12Z"
            />
          </svg>
        </button>
      </header>

      <div className="ruler fade-seq d1" />

      <section className="cluster fade-seq d1">
        <div className="sec-label">
          Instrument Cluster
          <span className="sec-note">{t("cluster.note")}</span>
        </div>
        <StatStrip totals={monitor?.totals ?? null} hist={totalsHist} />
        <SpendStrip spend={spend} settings={settings} agentById={agentById} />
      </section>

      <div className="deck__scroll">

      {monitor && monitor.alerts.length > 0 && (
        <section className="alerts-sec fade-seq d1">
          <div className="sec-label">
            <b>!</b> Alert Center
            <span className="sec-note">
              {t("alert.note", { open: monitor.totals.alerts, total: monitor.alerts.length })}
            </span>
          </div>
          <AlertCenter alerts={monitor.alerts} />
        </section>
      )}

      <section className="fleet-sec fade-seq d1">
        <div className="sec-label">
          <b>01</b> Detected Agents
          <span className="sec-note">
            {scanning
              ? t("deck.fleet.scanning")
              : t("deck.fleet.note", {
                  found: agents.length,
                  scanned: discovery?.scanned ?? 0
                })}
          </span>
          <button
            type="button"
            className={`rescan${scanning ? " is-busy" : ""}`}
            onClick={runScan}
            disabled={scanning}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path d="M13.8 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {scanning ? t("deck.rescanning") : t("deck.rescan")}
          </button>
        </div>
        {agents.length === 0 && (
          <div className="fleet-empty">
            {scanning ? t("common.scanning") : t("deck.fleet.empty")}
          </div>
        )}
        {activeFleet.length > 0 && (
          <div className="fleet-active">
            {activeFleet.map((a) => (
              <ActiveAgentCard
                key={a.id}
                agent={a}
                runtime={runtimeById.get(a.id)}
                sessions={sessionsByAgent.get(a.id) ?? []}
                quota={quotaBySource.get(a.id)}
                billing={settings?.billing?.[a.id]}
                onConfigureQuota={() => setSettingsOpen(true)}
              />
            ))}
          </div>
        )}
        {idleFleet.length > 0 && (
          <div className="fleet-idle">
            <span className="fleet-idle__lbl">{t("deck.idle")}</span>
            {idleFleet.map((a) => (
              <IdleChip key={a.id} agent={a} />
            ))}
          </div>
        )}
      </section>

      <main className="stage fade-seq d2">
        <div className="sec-label">
          <b>02</b> Live Runtime
          <span className="sec-note">
            {/* paused if the user paused (local intent, instant) OR main stopped ticking */}
            <i className={`rt-live${running && (!monitor || monitor.running) ? "" : " is-paused"}`} />
            {monitor
              ? t("deck.runtime.note", {
                  procs: monitor.totals.procs,
                  interval: (monitor.intervalMs / 1000).toFixed(1)
                })
              : t("deck.runtime.connecting")}
          </span>
          <button
            type="button"
            className={`rescan${running ? "" : " is-busy"}`}
            onClick={toggleRunning}
          >
            {running ? t("deck.pause") : t("deck.resume")}
          </button>
        </div>
        <div className="stage__panel">
          {monitor && runtimeAgents.length === 0 && (
            <>
              <RadarSweep />
              <div className="empty">
                <span className="chip">Idle · No Agent Process</span>
                <h2>{t("deck.empty.title")}</h2>
                <p>{t("deck.empty.body")}</p>
              </div>
            </>
          )}
          {!monitor && (
            <>
              <RadarSweep />
              <div className="empty">
                <span className="chip">Connecting</span>
                <h2>{t("deck.connecting.title")}</h2>
              </div>
            </>
          )}
          {monitor && runtimeAgents.length > 0 && (
            <div className="rt">
              <div className="rt__summary">
                {runtimeAgents.map((rt) => (
                  <RuntimeSummary key={rt.agentId} rt={rt} agent={agentById.get(rt.agentId)} />
                ))}
              </div>
              {(idleAgents.length > 0 || listenPorts.length > 0) && (
                <div className="rt__meta">
                  {idleAgents.length > 0 && (
                    <span className="rt__idle">
                      {t("deck.idleAgents", {
                        names: idleAgents.map((a) => a.name).join(" · ")
                      })}
                    </span>
                  )}
                  {listenPorts.length > 0 && (
                    <span className="rt__ports">
                      {listenPorts.slice(0, 10).map((p) => (
                        <em
                          key={`${p.pid}-${p.localPort}`}
                          className={p.orphan ? "is-orphan" : ""}
                          title={
                            p.orphan
                              ? t("deck.orphanPortTitle", { process: p.process })
                              : p.process
                          }
                        >
                          {p.localPort}
                          {p.orphan ? " ⚠" : ""}
                        </em>
                      ))}
                    </span>
                  )}
                  {(() => {
                    const orphanPids = [...new Set(listenPorts.filter((p) => p.orphan).map((p) => p.pid))];
                    if (orphanPids.length === 0) return null;
                    const isArmed = armed === "orphans";
                    return (
                      <button
                        type="button"
                        className={`rt__clean${isArmed ? " armed" : ""}`}
                        onClick={() => cleanOrphans(orphanPids)}
                        title={t("deck.orphanTitle")}
                      >
                        {isArmed
                          ? t("deck.orphanConfirm", { n: orphanPids.length })
                          : t("deck.orphanClean", { n: orphanPids.length })}
                      </button>
                    );
                  })()}
                </div>
              )}
              <div className="rt__tree">
                <div className="rt__tree-head">
                  <span>PROCESS TREE</span>
                  <input
                    className="rt__filter"
                    placeholder={t("deck.procFilter")}
                    value={procFilter}
                    onChange={(e) => setProcFilter(e.target.value)}
                  />
                  <span>
                    {monitor.processes.length} procs · {monitor.totals.listenPorts} listening
                  </span>
                </div>
                <div className="rt__rows">
                  {filteredProcs.map((p) => (
                    <ProcRow
                      key={p.pid}
                      p={p}
                      agent={agentById.get(p.agentId)}
                      busy={actionPid === p.pid}
                      killArmed={armed === `killPid:${p.pid}`}
                      treeArmed={armed === `killTree:${p.pid}`}
                      hot={hlAgent === p.agentId}
                      onKill={killProc}
                      onHover={setHlAgent}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="footnote fade-seq d3">
        <span>Agent Cockpit — Local Observability Instrument</span>
        <span>{info ? `${info.platformLabel} ${info.osRelease} · v${info.appVersion}` : "REV.0"}</span>
      </footer>

      </div>

      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onPatch={patchSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <HealthAudit open={auditOpen} onClose={() => setAuditOpen(false)} />
    </div>
  );
}
