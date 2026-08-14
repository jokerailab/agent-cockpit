import si from "systeminformation";
import { cpus } from "node:os";
import { BrowserWindow, type WebContents } from "electron";

/** CPU core count — ps %cpu is per-core, so aggregates are divided by this
 * to express agent CPU as a share of the whole machine (0–100%). */
const CORES = Math.max(1, cpus().length);
import { IpcChannels } from "@shared/ipc";
import type {
  AgentRuntime,
  MonitorAction,
  MonitorActionResult,
  MonitorProcess,
  MonitorSnapshot,
  PortInfo,
  SeriesPoint
} from "@shared/monitor";
import type { DetectedAgent } from "@shared/agents";
import { getLastDiscovery, scanAgents } from "../discovery/engine";
import { getLastSessions } from "../sessions/engine";
import { evaluateAlerts } from "../alerts/engine";
import { insertHistory, pruneHistory, pruneLedger } from "../store/db";

const SERIES_LEN = 40;
const MIN_INTERVAL = 1000;
const MAX_INTERVAL = 60000;

/** dev-server processes agents commonly leave listening */
const DEV_SERVER_RE =
  /\b(vite|next|nuxt|webpack|webpack-dev-server|http-server|serve|live-server|rollup|parcel|astro|remix|gatsby|ng serve|rails s|flask|uvicorn|gunicorn|http\.server|preview)\b/;

let intervalMs = 2500;
let timer: NodeJS.Timeout | null = null;
let ticking = false;
let paused = false; // explicit user pause — survives interval/visibility changes
const subscribers = new Set<WebContents>();
const seriesMap = new Map<string, SeriesPoint[]>();
let lastSnapshot: MonitorSnapshot | null = null;
let tickListener: ((snap: MonitorSnapshot) => void) | null = null;
let lastHistoryWrite = 0;
const HISTORY_EVERY_MS = 30_000;
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** main registers a hook to update the tray/menu-bar on every tick */
export function setTickListener(fn: (snap: MonitorSnapshot) => void): void {
  tickListener = fn;
}

/** Process-name tokens per agent id (extra hints beyond the id itself). */
const PROC_TOKENS: Record<string, string[]> = {
  claude: ["claude"],
  codex: ["codex"],
  gemini: ["gemini"],
  cursor: ["cursor"],
  opencode: ["opencode"],
  lingma: ["lingma", "cosy"],
  qwen: ["qwen"],
  aider: ["aider"],
  goose: ["goose"],
  amp: ["amp"],
  antigravity: ["antigravity"],
  windsurf: ["windsurf", "codeium"],
  codebuddy: ["codebuddy"],
  trae: ["trae"],
  codegeex: ["codegeex"]
};

interface Matcher {
  agentId: string;
  binPath: string | null;
  tokens: string[];
}

/** Interpreter executables whose real identity is the script they run. */
const RUNTIMES = new Set([
  "node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "electron"
]);

function buildMatchers(agents: DetectedAgent[]): Matcher[] {
  return agents.map((a) => ({
    agentId: a.id,
    binPath: a.binPath ? a.binPath.toLowerCase() : null,
    tokens: (PROC_TOKENS[a.id] || [a.id]).map((t) => t.toLowerCase())
  }));
}

interface ProcLike {
  command?: string;
  name?: string;
  params?: string;
}

/**
 * Identity tokens for a process: executable basename + process name, and —
 * for interpreters (node/python/…) — the run script's basename.
 * Deliberately ignores arbitrary args/cwd so config-dir paths like ~/.claude
 * in unrelated processes don't cause false matches.
 */
function identityTokens(p: ProcLike): { tokens: string[]; exe: string } {
  const cmd = (p.command || "").trim();
  const exe = (cmd.split(/\s+/)[0] || "").toLowerCase();
  const base = exe.split("/").pop() || (p.name || "").toLowerCase();
  const tokens = new Set<string>();
  if (base) tokens.add(base);
  const name = (p.name || "").toLowerCase();
  if (name) tokens.add(name);
  if (RUNTIMES.has(base)) {
    const params = (p.params || "").trim();
    const firstArg = params.split(/\s+/).find((a) => a && !a.startsWith("-")) || "";
    const scriptBase = (firstArg.split("/").pop() || "").toLowerCase();
    if (scriptBase) tokens.add(scriptBase);
  }
  return { tokens: [...tokens], exe };
}

function matchAgent(p: ProcLike, matchers: Matcher[]): string | null {
  const { tokens, exe } = identityTokens(p);
  for (const m of matchers) {
    if (m.binPath && exe === m.binPath) return m.agentId;
    for (const tok of tokens) {
      for (const t of m.tokens) {
        if (tok === t || tok.startsWith(`${t} `) || tok.startsWith(`${t}-`) || tok.startsWith(`${t}_`)) {
          return m.agentId;
        }
      }
    }
  }
  return null;
}

function startedToSec(started: string): number {
  const ms = Date.parse(started.replace(" ", "T"));
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round((Date.now() - ms) / 1000));
}

async function collect(): Promise<MonitorSnapshot> {
  let discovery = getLastDiscovery();
  if (!discovery) discovery = await scanAgents();
  const matchers = buildMatchers(discovery.agents);

  const [psData, netData] = await Promise.all([
    si.processes(),
    si.networkConnections().catch(() => [] as si.Systeminformation.NetworkConnectionsData[])
  ]);

  const procs = psData.list;
  const byPid = new Map<number, (typeof procs)[number]>();
  const childrenOf = new Map<number, number[]>();
  for (const p of procs) {
    byPid.set(p.pid, p);
    const arr = childrenOf.get(p.parentPid) || [];
    arr.push(p.pid);
    childrenOf.set(p.parentPid, arr);
  }

  // direct matches
  const MAX_DEPTH = 8;
  const directAgent = new Map<number, string>();
  for (const p of procs) {
    const agentId = matchAgent(p, matchers);
    if (agentId) directAgent.set(p.pid, agentId);
  }

  // inherit agent down the tree from matched roots (depth-capped)
  const procAgent = new Map<number, string>(directAgent);
  const depthOf = new Map<number, number>();
  for (const [rootPid, agentId] of directAgent) {
    depthOf.set(rootPid, 0);
    const queue: Array<[number, number]> = [[rootPid, 0]];
    while (queue.length) {
      const [pid, depth] = queue.shift()!;
      if (depth >= MAX_DEPTH) continue;
      for (const child of childrenOf.get(pid) || []) {
        if (directAgent.has(child)) continue; // child matched another agent directly
        if (!procAgent.has(child)) {
          procAgent.set(child, agentId);
          depthOf.set(child, depth + 1);
          queue.push([child, depth + 1]);
        }
      }
    }
  }

  // order processes as a proper tree: agent by agent, each root followed by its
  // descendants (DFS), children sorted by cpu. Keeps the indentation readable.
  const cpuOf = (pid: number): number => byPid.get(pid)?.cpu || 0;
  const ordered: number[] = [];
  const seen = new Set<number>();
  const emit = (pid: number): void => {
    if (seen.has(pid)) return;
    seen.add(pid);
    ordered.push(pid);
    const agentId = procAgent.get(pid);
    const kids = (childrenOf.get(pid) || [])
      .filter((c) => procAgent.get(c) === agentId && !seen.has(c))
      .sort((a, b) => cpuOf(b) - cpuOf(a));
    for (const k of kids) emit(k);
  };
  for (const a of discovery.agents) {
    const roots = [...procAgent.entries()]
      .filter(([pid, aid]) => {
        if (aid !== a.id) return false;
        const parentAgent = procAgent.get(byPid.get(pid)?.parentPid ?? -1);
        return parentAgent !== a.id;
      })
      .map(([pid]) => pid)
      .sort((x, y) => cpuOf(y) - cpuOf(x));
    for (const r of roots) emit(r);
  }
  for (const pid of procAgent.keys()) emit(pid); // leftover safety

  const monitored: MonitorProcess[] = ordered.map((pid) => {
    const p = byPid.get(pid)!;
    const agentId = procAgent.get(pid)!;
    const parentAgent = procAgent.get(p.parentPid);
    return {
      agentId,
      pid,
      ppid: p.parentPid,
      command: (p.command || p.name || "").slice(0, 200),
      cpu: round1(p.cpu || 0),
      mem: round1(p.mem || 0),
      elapsedSec: startedToSec(p.started || ""),
      depth: depthOf.get(pid) ?? 0,
      isRoot: parentAgent !== agentId
    };
  });

  // ports owned by monitored pids
  const pidAgent = procAgent;
  const ports: PortInfo[] = [];
  for (const c of netData) {
    const pid = Number(c.pid);
    const agentId = pidAgent.get(pid);
    if (!agentId) continue;
    if (c.state !== "LISTEN" && c.state !== "ESTABLISHED") continue;
    const proc = byPid.get(pid);
    const cmd = `${proc?.command || ""} ${proc?.params || ""} ${c.process || ""}`.toLowerCase();
    const orphan = c.state === "LISTEN" && DEV_SERVER_RE.test(cmd);
    ports.push({
      agentId,
      pid,
      protocol: c.protocol,
      localPort: String(c.localPort),
      state: c.state,
      process: c.process || "",
      orphan
    });
  }

  // per-agent aggregation + series
  const agents: AgentRuntime[] = [];
  for (const a of discovery.agents) {
    const aProcs = monitored.filter((p) => p.agentId === a.id);
    // ps %cpu is per-core; divide by cores → share of whole machine (0–100)
    const totalCpu = round1(Math.min(100, aProcs.reduce((s, p) => s + p.cpu, 0) / CORES));
    const totalMem = round1(aProcs.reduce((s, p) => s + p.mem, 0));
    const listenPorts = ports.filter((p) => p.agentId === a.id && p.state === "LISTEN").length;
    const longest = aProcs.reduce((m, p) => Math.max(m, p.elapsedSec), 0);

    const series = seriesMap.get(a.id) || [];
    series.push({ cpu: totalCpu, mem: totalMem });
    while (series.length > SERIES_LEN) series.shift();
    seriesMap.set(a.id, series);

    agents.push({
      agentId: a.id,
      procCount: aProcs.length,
      rootCount: aProcs.filter((p) => p.isRoot).length,
      totalCpu,
      totalMem,
      listenPorts,
      longestElapsedSec: longest,
      series: [...series]
    });
  }

  const totals = {
    procs: monitored.length,
    cpu: round1(Math.min(100, agents.reduce((s, a) => s + a.totalCpu, 0))),
    mem: round1(agents.reduce((s, a) => s + a.totalMem, 0)),
    listenPorts: ports.filter((p) => p.state === "LISTEN").length,
    alerts: 0
  };

  const snap: MonitorSnapshot = {
    generatedAt: new Date().toISOString(),
    intervalMs,
    running: timer !== null,
    totals,
    agents,
    processes: monitored,
    ports,
    alerts: []
  };
  snap.alerts = evaluateAlerts(snap, getLastSessions());
  snap.totals.alerts = snap.alerts.filter((a) => a.severity !== "info").length;
  return snap;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function broadcast(snap: MonitorSnapshot): void {
  for (const wc of subscribers) {
    if (wc.isDestroyed()) {
      subscribers.delete(wc);
      continue;
    }
    // skip hidden windows (e.g. the menu-bar popover when closed) — avoids
    // serializing the full snapshot to a window that won't render it
    const win = BrowserWindow.fromWebContents(wc);
    if (win && !win.isVisible()) continue;
    wc.send(IpcChannels.monitorTick, snap);
  }
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    lastSnapshot = await collect();
    broadcast(lastSnapshot);
    if (tickListener) tickListener(lastSnapshot);
    const now = Date.now();
    if (now - lastHistoryWrite >= HISTORY_EVERY_MS) {
      lastHistoryWrite = now;
      const t = lastSnapshot.totals;
      try {
        insertHistory({ ts: now, procs: t.procs, cpu: t.cpu, mem: t.mem, ports: t.listenPorts, alerts: t.alerts });
        pruneHistory(now - HISTORY_RETENTION_MS);
        pruneLedger(now - 60 * 24 * 60 * 60 * 1000); // keep spend ledger 60 days
      } catch {
        /* db optional */
      }
    }
  } catch {
    /* swallow a single bad tick */
  } finally {
    ticking = false;
  }
}

function ensureTimer(): void {
  if (paused || timer || subscribers.size === 0) return;
  void tick();
  timer = setInterval(() => void tick(), intervalMs);
}

function clearTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function addSubscriber(wc: WebContents): void {
  subscribers.add(wc);
  wc.once("destroyed", () => subscribers.delete(wc));
  if (lastSnapshot) wc.send(IpcChannels.monitorTick, lastSnapshot);
  ensureTimer();
}

export function removeSubscriber(wc: WebContents): void {
  subscribers.delete(wc);
  if (subscribers.size === 0) clearTimer();
}

export function control(opts: { running?: boolean; intervalMs?: number }): void {
  if (typeof opts.intervalMs === "number") {
    intervalMs = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(opts.intervalMs)));
    if (timer) {
      clearTimer();
      ensureTimer();
    }
  }
  if (typeof opts.running === "boolean") {
    paused = !opts.running;
    if (opts.running) ensureTimer();
    else clearTimer();
  }
}

export async function runAction(action: MonitorAction, pid: number): Promise<MonitorActionResult> {
  // safety: only act on pids we currently monitor
  const known = lastSnapshot?.processes.find((p) => p.pid === pid);
  if (!known) return { ok: false, error: "pid not in monitored agent set" };

  const targets: number[] = [pid];
  if (action === "killTree") {
    const all = lastSnapshot?.processes || [];
    const childrenOf = new Map<number, number[]>();
    for (const p of all) {
      const arr = childrenOf.get(p.ppid) || [];
      arr.push(p.pid);
      childrenOf.set(p.ppid, arr);
    }
    const queue = [pid];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const child of childrenOf.get(cur) || []) {
        if (!targets.includes(child)) {
          targets.push(child);
          queue.push(child);
        }
      }
    }
  }

  try {
    // kill children first, root last
    for (const t of targets.reverse()) {
      try {
        process.kill(t, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    void tick();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "kill failed" };
  }
}
