import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { t } from "@shared/i18n";
import type { Alert, AlertConfig } from "@shared/alerts";
import { DEFAULT_ALERT_CONFIG } from "@shared/alerts";
import type { MonitorSnapshot } from "@shared/monitor";
import type { SessionScanResult } from "@shared/sessions";

const HOME = homedir();
let config: AlertConfig = { ...DEFAULT_ALERT_CONFIG };

/** per-pid consecutive ticks above the cpu threshold (debounce) */
const cpuStreak = new Map<number, number>();
/** alertId → epoch ms first seen (stable "since") */
const sinceMap = new Map<string, number>();

export function setAlertConfig(partial: Partial<AlertConfig>): void {
  config = { ...config, ...partial };
}

/* ── security scan (cached; settings rarely change) ────────────── */
interface SecFinding {
  id: string;
  severity: Alert["severity"];
  title: string;
  detail: string;
  agentId: string | null;
}
let secCache: { at: number; findings: SecFinding[] } | null = null;
const SEC_TTL = 30_000;

function scanSecurity(): SecFinding[] {
  const now = Date.now();
  if (secCache && now - secCache.at < SEC_TTL) return secCache.findings;
  const findings: SecFinding[] = [];

  // Claude: broad Bash permission
  try {
    const f = join(HOME, ".claude", "settings.json");
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8"));
      const allow: string[] = j?.permissions?.allow ?? [];
      const broad = allow.find((a) => /^Bash\(\s*\*\s*\)$|^Bash$|^Bash\(:\*\)$/.test(a));
      if (broad) {
        findings.push({
          id: "sec:claude:bash",
          severity: "warn",
          title: t("alert.sec.claudeBash.title"),
          detail: t("alert.sec.claudeBash.detail", { rule: broad }),
          agentId: "claude"
        });
      }
    }
  } catch {
    /* ignore */
  }

  // Gemini: many trusted folders
  try {
    const f = join(HOME, ".gemini", "trustedFolders.json");
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8"));
      const folders = Array.isArray(j) ? j : Object.keys(j || {});
      if (folders.length >= 10) {
        findings.push({
          id: "sec:gemini:trust",
          severity: "info",
          title: t("alert.sec.geminiTrust.title"),
          detail: t("alert.sec.geminiTrust.detail", { count: folders.length }),
          agentId: "gemini"
        });
      }
    }
  } catch {
    /* ignore */
  }

  secCache = { at: now, findings };
  return findings;
}

/* ── main evaluation ───────────────────────────────────────────── */
export function evaluateAlerts(
  mon: MonitorSnapshot,
  sessions: SessionScanResult | null
): Alert[] {
  const now = Date.now();
  const raw: Array<Omit<Alert, "since">> = [];

  // A. context window approaching compaction
  for (const s of sessions?.sessions ?? []) {
    if (s.contextPct >= config.contextWarnPct) {
      const critical = s.contextPct >= 0.92;
      raw.push({
        id: `ctx:${s.id}`,
        category: "context",
        severity: critical ? "critical" : "warn",
        title: t("alert.context.title", { pct: Math.round(s.contextPct * 100) }),
        detail: t("alert.context.detail", { project: s.project }),
        agentId: s.agentId
      });
    }
  }

  // A2. high burn rate — a session spending fast right now (guardian, not a report)
  for (const s of sessions?.sessions ?? []) {
    if (s.activity === "working" && s.costRate >= config.burnWarnUsdPerMin) {
      raw.push({
        id: `burn:${s.id}`,
        category: "burn",
        severity: s.costRate >= config.burnWarnUsdPerMin * 2 ? "critical" : "warn",
        title: t("alert.burn.title", { rate: s.costRate.toFixed(1) }),
        detail: t("alert.burn.detail", {
          project: s.project,
          total: Math.round(s.costUsd ?? 0)
        }),
        agentId: s.agentId
      });
    }
  }

  // A3. session health — spinning / degeneration / context blowout (guardian)
  for (const s of sessions?.sessions ?? []) {
    if (s.healthStatus === "failing") {
      raw.push({
        id: `health:${s.id}`,
        category: "health",
        severity: "critical",
        title: t("alert.health.title", { score: s.healthScore }),
        detail: t("alert.health.detail", {
          project: s.project,
          diag: s.healthDiag ?? t("health.diag.lowScore")
        }),
        agentId: s.agentId
      });
    }
  }

  // B. rate-limit quota
  for (const q of sessions?.quotas ?? []) {
    const win = (label: string, w: { pct: number; resetsAt: number | null } | null): void => {
      if (!w) return;
      if (w.resetsAt && w.resetsAt * 1000 < now) return; // expired/stale
      if (w.pct >= config.quotaWarnPct) {
        raw.push({
          id: `quota:${q.source}:${label}`,
          category: "quota",
          severity: w.pct >= 95 ? "critical" : "warn",
          title: t("alert.quota.title", {
            source: q.source,
            window: label,
            pct: Math.round(w.pct)
          }),
          detail: t("alert.quota.detail"),
          agentId: q.source
        });
      }
    };
    win("5h", q.fiveHour);
    win("7d", q.sevenDay);
  }

  // C. resource — per-process sustained CPU + high memory
  const livePids = new Set<number>();
  for (const p of mon.processes) {
    livePids.add(p.pid);
    if (p.cpu >= config.cpuWarnPct) {
      const streak = (cpuStreak.get(p.pid) ?? 0) + 1;
      cpuStreak.set(p.pid, streak);
      if (streak >= config.cpuSustainTicks) {
        raw.push({
          id: `cpu:${p.pid}`,
          category: "resource",
          severity: "critical",
          title: t("alert.cpu.title", { pct: p.cpu }),
          detail: t("alert.cpu.detail", { pid: p.pid, command: p.command.slice(0, 48) }),
          agentId: p.agentId
        });
      }
    } else {
      cpuStreak.delete(p.pid);
    }
    if (p.mem >= config.memWarnPct) {
      raw.push({
        id: `mem:${p.pid}`,
        category: "resource",
        severity: "warn",
        title: t("alert.mem.title", { pct: p.mem }),
        detail: t("alert.mem.detail", { pid: p.pid, command: p.command.slice(0, 48) }),
        agentId: p.agentId
      });
    }
  }
  for (const pid of [...cpuStreak.keys()]) if (!livePids.has(pid)) cpuStreak.delete(pid);

  // D. orphan dev-server ports
  for (const port of mon.ports) {
    if (port.orphan) {
      raw.push({
        id: `orphan:${port.pid}:${port.localPort}`,
        category: "port",
        severity: "warn",
        title: t("alert.orphan.title", { port: port.localPort }),
        detail: t("alert.orphan.detail", {
          process: port.process || "dev server",
          pid: port.pid
        }),
        agentId: port.agentId
      });
    }
  }

  // E. security footprint
  for (const f of scanSecurity()) {
    raw.push({ ...f, category: "security" });
  }

  // stable "since" + cleanup
  const seen = new Set<string>();
  const alerts: Alert[] = raw.map((a) => {
    seen.add(a.id);
    let since = sinceMap.get(a.id);
    if (!since) {
      since = now;
      sinceMap.set(a.id, since);
    }
    return { ...a, since };
  });
  for (const k of [...sinceMap.keys()]) if (!seen.has(k)) sinceMap.delete(k);

  const rank = { critical: 0, warn: 1, info: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.since - b.since);
  return alerts;
}
