import { homedir } from "node:os";
import { join, basename } from "node:path";
import {
  existsSync,
  readdirSync,
  readFileSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  statSync
} from "node:fs";
import { execFile } from "node:child_process";
import { priceSession } from "./pricing";
import { recordSpend } from "../store/db";
import { t } from "@shared/i18n";
import {
  burnRate,
  computeActivity,
  degenerateRun,
  extractText,
  hasToolError,
  hasToolResult,
  hasToolUse,
  modelLimit,
  scoreHealth,
  statusFrom,
  type DiagKey
} from "./health";
import type {
  AccountQuota,
  AgentSession,
  RateWindow,
  SessionActivity,
  SessionAudit,
  SessionScanResult
} from "@shared/sessions";

const HOME = homedir();
const ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const TAIL_BYTES = 96 * 1024;
const MAX_SESSIONS = 24;
const RATE_WINDOW_MS = 5 * 60 * 1000; // token-rate measurement window

/** parsed-session cache keyed by file path → invalidated by mtime+size.
 * Used by Codex (cheap tail read). Claude uses incremental state below. */
const cache = new Map<string, { sig: string; session: AgentSession }>();

/**
 * Incremental Claude parse state — keyed by file path. Holds the byte offset
 * consumed so far plus running accumulators, so an actively-growing jsonl is
 * re-read only for its new bytes instead of fully on every scan.
 */
interface ClaudeState {
  sig: string; // mtime:size of the last build — skip all IO when unchanged
  offset: number; // bytes fully consumed — always sits on a newline boundary
  model: string | null;
  cwd: string | null;
  gitBranch: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  turnCount: number;
  msgCount: number;
  lastCtx: number; // most-recent assistant context footprint
  lastTask: string | null; // most-recent user text
  lastTs: string | null;
  recent: Array<[number, number]>; // [tsMs, outputTokens] within the rate window
  // turn-state signals (last message wins, scanning forward)
  lastMsgRole: "assistant" | "user" | null;
  lastAssistantStop: string | null; // stop_reason of most recent assistant msg
  lastUserToolResult: boolean; // last user msg was a tool_result (mid-turn)
  mtimeMs: number;
  costSamples: Array<[number, number]>; // [wallMs, cumulativeCostUsd] for burn rate
  turnFlags: Array<[boolean, number]>; // recent assistant turns: [emptyOutput, degenRun]
  recentTool: boolean[]; // recent tool_result outcomes (true = is_error)
  stallStreak: number; // consecutive short "continue"-style user nudges (stuck signal)
  compactions: number; // count of compact_boundary events (context churn)
  session: AgentSession | null;
}
// i18n-exempt: matches what the USER types to nudge an agent, in either language
const NUDGE_RE = /^(继续|接着|go on|keep going|continue|proceed|next|go|嗯|好|ok)\s*[。.!！~]*$/i;
const claudeStates = new Map<string, ClaudeState>();
const BURN_WINDOW_MS = 3 * 60 * 1000;
const HEALTH_WINDOW = 30; // assistant turns kept for health signals

function freshClaudeState(sig: string): ClaudeState {
  return {
    sig,
    offset: 0,
    model: null,
    cwd: null,
    gitBranch: null,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreate: 0,
    turnCount: 0,
    msgCount: 0,
    lastCtx: 0,
    lastTask: null,
    lastTs: null,
    recent: [],
    lastMsgRole: null,
    lastAssistantStop: null,
    lastUserToolResult: false,
    mtimeMs: 0,
    costSamples: [],
    turnFlags: [],
    recentTool: [],
    stallStreak: 0,
    compactions: 0,
    session: null
  };
}

/** Render a health key into the active locale. The key travels alongside it on
 * the wire, so UI logic never has to parse this string. */
function diagText(key: DiagKey | null, params: Record<string, number>): string | null {
  return key ? t(`health.diag.${key}`, params) : null;
}

function tailLines(file: string): string[] {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString("utf8").split("\n").filter(Boolean);
  } finally {
    closeSync(fd);
  }
}

const gitDirtyCache = new Map<string, { at: number; val: number | null }>();
const GIT_DIRTY_TTL = 20_000;

function gitDirty(cwd: string): Promise<number | null> {
  const cached = gitDirtyCache.get(cwd);
  if (cached && Date.now() - cached.at < GIT_DIRTY_TTL) return Promise.resolve(cached.val);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "status", "--porcelain", "--untracked-files=no"],
      { timeout: 1500, windowsHide: true },
      (err, stdout) => {
        const val = err ? null : stdout.split("\n").filter((l) => l.trim()).length;
        gitDirtyCache.set(cwd, { at: Date.now(), val });
        resolve(val);
      }
    );
  });
}

/* ── Claude (incremental parse, cumulative) ────────────────────── */

/** Fold one parsed jsonl record (read forward) into the running state. */
function foldClaudeLine(st: ClaudeState, obj: Record<string, unknown>): void {
  const type = obj["type"];
  if (type === "system" && obj["subtype"] === "compact_boundary") st.compactions++;
  const tsStr = typeof obj["timestamp"] === "string" ? (obj["timestamp"] as string) : null;
  if (tsStr) st.lastTs = tsStr; // forward scan → last wins = most recent
  if (!st.cwd && typeof obj["cwd"] === "string") st.cwd = obj["cwd"] as string;
  if (!st.gitBranch && typeof obj["gitBranch"] === "string") st.gitBranch = obj["gitBranch"] as string;

  const message = obj["message"] as Record<string, unknown> | undefined;
  if (type === "assistant" && message) {
    st.msgCount++;
    st.turnCount++;
    st.lastMsgRole = "assistant";
    st.lastAssistantStop =
      typeof message["stop_reason"] === "string" ? (message["stop_reason"] as string) : null;
    const usage = message["usage"] as Record<string, number> | undefined;
    if (usage) {
      const o = usage["output_tokens"] || 0;
      st.output += o;
      st.input += usage["input_tokens"] || 0;
      st.cacheRead += usage["cache_read_input_tokens"] || 0;
      st.cacheCreate += usage["cache_creation_input_tokens"] || 0;
      if (tsStr) {
        const ms = Date.parse(tsStr);
        if (!Number.isNaN(ms)) st.recent.push([ms, o]);
      }
      // most-recent assistant defines the live context footprint
      st.lastCtx =
        (usage["input_tokens"] || 0) +
        (usage["cache_read_input_tokens"] || 0) +
        (usage["cache_creation_input_tokens"] || 0);
      if (typeof message["model"] === "string") st.model = message["model"] as string;
    }
    // health signals: is this turn spinning (no visible output) or degenerate?
    const content = message["content"];
    const aText = extractText(content);
    const empty = (!aText || !aText.trim()) && !hasToolUse(content);
    st.turnFlags.push([empty, degenerateRun(aText)]);
    if (st.turnFlags.length > HEALTH_WINDOW) st.turnFlags.shift();
  } else if (type === "user" && message) {
    st.msgCount++;
    st.lastMsgRole = "user";
    const content = message["content"];
    const isToolRes = hasToolResult(content);
    st.lastUserToolResult = isToolRes;
    if (isToolRes) {
      st.recentTool.push(hasToolError(content));
      if (st.recentTool.length > HEALTH_WINDOW) st.recentTool.shift();
    }
    // NOT named `t` — that shadows the imported translate function
    const userText = extractText(content);
    if (userText) st.lastTask = userText; // forward → last wins = most recent task
    // a short "continue"-style nudge with no tool_result = you poking a stuck agent
    if (userText && !isToolRes) {
      st.stallStreak = NUDGE_RE.test(userText.trim().slice(0, 20)) ? st.stallStreak + 1 : 0;
    }
  }
}

function buildClaudeSession(file: string, st: ClaudeState): AgentSession {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  // prune recent ring outside the rate window, sum surviving output
  let i = 0;
  while (i < st.recent.length && st.recent[i]![0] < cutoff) i++;
  if (i > 0) st.recent.splice(0, i);
  let recentOut = 0;
  for (const [, o] of st.recent) recentOut += o;

  const lastTsMs = st.lastTs ? Date.parse(st.lastTs) : Date.now();
  // NOTE: keep the >200k probe — the jsonl `model` field has NO [1m] suffix
  // (it's e.g. "claude-opus-4-7"), so modelLimit() can't detect the 1M window.
  // A 200k model can't exceed 200k (it compacts first), so ctx>200k ⇒ 1M tier.
  // Removing this regresses the "150% context" bug. Verified 2026-06.
  const limit = st.lastCtx > 200_000 ? 1_000_000 : modelLimit(st.model);
  const contextPct = limit > 0 ? Math.min(1, st.lastCtx / limit) : 0;
  const total = st.input + st.output + st.cacheRead + st.cacheCreate;

  const session: AgentSession = {
    id: basename(file).replace(/\.jsonl$/, ""),
    agentId: "claude",
    project: st.cwd ? basename(st.cwd) : "—",
    cwd: st.cwd,
    model: st.model,
    status: statusFrom(Number.isNaN(lastTsMs) ? Date.now() : lastTsMs),
    activity: computeActivity(st),
    contextTokens: st.lastCtx,
    contextLimit: limit,
    contextPct,
    compactionRisk: contextPct >= 0.8,
    inputTokens: st.input,
    outputTokens: st.output,
    cacheRead: st.cacheRead,
    cacheCreate: st.cacheCreate,
    totalTokens: total,
    costUsd: null,
    costRate: 0,
    healthScore: 100,
    healthStatus: "healthy",
    healthDiag: null,
    healthDiagKey: null,
    tokenRate: Math.round(recentOut / (RATE_WINDOW_MS / 60000)),
    turnCount: st.turnCount,
    task: st.lastTask ? st.lastTask.replace(/\s+/g, " ").trim().slice(0, 120) : null,
    gitBranch: st.gitBranch,
    gitDirty: null,
    messageCount: st.msgCount,
    lastActiveAt: st.lastTs
  };
  session.costUsd = priceSession(session);
  // burn rate from cumulative-cost samples (only meaningful while growing; this
  // build runs only when the file changed, so samples track real activity)
  if (session.costUsd != null) {
    const now = Date.now();
    st.costSamples.push([now, session.costUsd]);
    while (st.costSamples.length && now - st.costSamples[0]![0] > BURN_WINDOW_MS) {
      st.costSamples.shift();
    }
    session.costRate = Math.round(burnRate(st.costSamples) * 100) / 100;
  }
  let fileBytes = 0;
  try {
    fileBytes = statSync(file).size;
  } catch {
    /* ignore */
  }
  const errorRatio =
    st.recentTool.length >= 8
      ? st.recentTool.filter(Boolean).length / st.recentTool.length
      : 0;
  const health = scoreHealth({
    turnFlags: st.turnFlags,
    contextPct,
    fileBytes,
    turnCount: st.turnCount,
    errorRatio,
    stallStreak: st.stallStreak,
    compactions: st.compactions
  });
  session.healthScore = health.score;
  session.healthStatus = health.status;
  session.healthDiagKey = health.diagKey;
  session.healthDiag = diagText(health.diagKey, health.diagParams);
  return session;
}

/**
 * Incrementally parse a Claude jsonl. Reads only bytes appended since the last
 * call (tracked by byte offset); a shrunk file (rotation/truncation) resets the
 * accumulators. Returns null only if the file can't be opened.
 */
function readClaudeSession(file: string, sig: string): AgentSession | null {
  let st = claudeStates.get(file);
  if (st && st.sig === sig && st.session) return st.session; // unchanged → no IO

  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const fstat = fstatSync(fd);
    const size = fstat.size;
    if (!st || size < st.offset) st = freshClaudeState(sig); // new or truncated/rotated
    st.mtimeMs = fstat.mtimeMs;
    const newLen = size - st.offset;
    if (newLen > 0) {
      const buf = Buffer.alloc(newLen);
      readSync(fd, buf, 0, newLen, st.offset);
      // parse only up to the last newline; any partial trailing line is left
      // for the next scan (offset stays on a newline boundary, so slicing here
      // never splits a multibyte char — 0x0a can't appear inside a UTF-8 seq).
      const lastNl = buf.lastIndexOf(0x0a);
      if (lastNl >= 0) {
        const complete = buf.subarray(0, lastNl + 1).toString("utf8");
        for (const line of complete.split("\n")) {
          if (!line) continue;
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          foldClaudeLine(st, obj);
        }
        st.offset += lastNl + 1;
      }
    }
  } catch {
    closeSync(fd);
    return st?.session ?? null;
  }
  closeSync(fd);

  st.sig = sig;
  st.session = buildClaudeSession(file, st);
  claudeStates.set(file, st);
  return st.session;
}

/* ── Codex (tail read: token_count + rate_limits) ──────────────── */
function parseCodex(file: string): { session: AgentSession; quota: AccountQuota | null } | null {
  let lines: string[];
  try {
    lines = tailLines(file);
  } catch {
    return null;
  }
  let info: Record<string, unknown> | null = null;
  let rateLimits: Record<string, unknown> | null = null;
  let cwd: string | null = null;
  let model: string | null = null;
  let lastTs: string | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(lines[i]!);
    } catch {
      continue;
    }
    const payload = (obj["payload"] as Record<string, unknown>) || obj;
    if (!lastTs && typeof obj["timestamp"] === "string") lastTs = obj["timestamp"] as string;
    if (!cwd && typeof payload["cwd"] === "string") cwd = payload["cwd"] as string;
    if (!model && typeof payload["model"] === "string") model = payload["model"] as string;
    if (!info && (payload["type"] === "token_count" || obj["type"] === "token_count")) {
      info = (payload["info"] as Record<string, unknown>) || null;
      const rl = payload["rate_limits"];
      if (rl && typeof rl === "object") rateLimits = rl as Record<string, unknown>;
    }
    if (info && rateLimits && cwd) break;
  }
  if (!info) return null;

  const totalU = (info["total_token_usage"] as Record<string, number>) || {};
  const lastU = (info["last_token_usage"] as Record<string, number>) || {};
  const ctxWindow = (info["model_context_window"] as number) || 272_000;
  const cacheRead = totalU["cached_input_tokens"] || 0;
  const inputTokens = (totalU["input_tokens"] || 0) - cacheRead; // codex input includes cache
  const outputTokens = totalU["output_tokens"] || 0;
  const contextTokens = lastU["input_tokens"] || 0;
  const lastMs = lastTs ? Date.parse(lastTs) : Date.now();

  const session: AgentSession = {
    id: basename(file).replace(/\.jsonl$/, ""),
    agentId: "codex",
    project: cwd ? basename(cwd) : "codex",
    cwd,
    model,
    status: statusFrom(lastMs),
    // codex session logs don't expose turn state; approximate from recency
    // rather than falsely claim "working"
    activity: statusFrom(lastMs) === "idle" ? "idle" : "awaiting",
    contextTokens,
    contextLimit: ctxWindow,
    contextPct: ctxWindow > 0 ? Math.min(1, contextTokens / ctxWindow) : 0,
    compactionRisk: ctxWindow > 0 && contextTokens / ctxWindow >= 0.8,
    inputTokens: Math.max(0, inputTokens),
    outputTokens,
    cacheRead,
    cacheCreate: 0,
    totalTokens: (totalU["total_tokens"] as number) || inputTokens + outputTokens + cacheRead,
    costUsd: null,
    costRate: 0,
    healthScore: 100,
    healthStatus: "healthy",
    healthDiag: null,
    healthDiagKey: null,
    tokenRate: 0,
    turnCount: 0,
    task: null,
    gitBranch: null,
    gitDirty: null,
    messageCount: 0,
    lastActiveAt: lastTs
  };
  session.costUsd = priceSession(session);

  let quota: AccountQuota | null = null;
  if (rateLimits) {
    const mk = (w: unknown): RateWindow | null => {
      if (!w || typeof w !== "object") return null;
      const o = w as Record<string, number>;
      if (typeof o["used_percent"] !== "number") return null;
      return { pct: o["used_percent"], resetsAt: o["resets_at"] ?? null };
    };
    const slots = Object.values(rateLimits) as Array<Record<string, number>>;
    let five: RateWindow | null = null;
    let seven: RateWindow | null = null;
    for (const w of slots) {
      const win = mk(w);
      if (!win) continue;
      if ((w["window_minutes"] || 0) <= 300) five = win;
      else seven = win;
    }
    if (five || seven) {
      quota = {
        source: "codex",
        fiveHour: five,
        sevenDay: seven,
        updatedAt: lastTs ? Math.floor(Date.parse(lastTs) / 1000) : null
      };
    }
  }
  return { session, quota };
}

/* ── file discovery ────────────────────────────────────────────── */
function activeClaudeFiles(): Array<{ file: string; sig: string }> {
  const root = join(HOME, ".claude", "projects");
  if (!existsSync(root)) return [];
  const out: Array<{ file: string; sig: string }> = [];
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  for (const d of dirs) {
    const full = join(root, d);
    let files: string[];
    try {
      files = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(full, f);
      try {
        const st = statSync(fp);
        if (st.mtimeMs >= cutoff) out.push({ file: fp, sig: `${st.mtimeMs}:${st.size}` });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

const AUDIT_DAYS = 45;
const AUDIT_MAX = 150;
const nextTick = (): Promise<void> => new Promise((r) => setImmediate(r));

/**
 * Full-fleet health audit: score EVERY recent Claude session (not just the live
 * 30-min window) so you can triage the graveyard — which old conversations are
 * spinning/degenerate/blown-out and should be abandoned. On-demand (heavy IO);
 * reuses the incremental parser + cache, so re-runs are cheap. Claude only —
 * health signals don't apply to Codex's tail format.
 */
export async function auditSessions(): Promise<SessionAudit[]> {
  const root = join(HOME, ".claude", "projects");
  if (!existsSync(root)) return [];
  const cutoff = Date.now() - AUDIT_DAYS * 24 * 3600 * 1000;
  const found: Array<{ file: string; sig: string; mtime: number; size: number }> = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  for (const d of dirs) {
    const full = join(root, d);
    let names: string[];
    try {
      names = readdirSync(full);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(full, f);
      try {
        const st = statSync(fp);
        if (st.mtimeMs >= cutoff) {
          found.push({ file: fp, sig: `${st.mtimeMs}:${st.size}`, mtime: st.mtimeMs, size: st.size });
        }
      } catch {
        /* ignore */
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime); // newest first, then cap
  const rows: SessionAudit[] = [];
  const batch = found.slice(0, AUDIT_MAX);
  for (let i = 0; i < batch.length; i++) {
    if (i % 5 === 0) await nextTick(); // keep the event loop breathing on big files
    const { file, sig, size } = batch[i]!;
    const s = readClaudeSession(file, sig);
    if (!s) continue;
    rows.push({
      id: s.id,
      project: s.project,
      agentId: s.agentId,
      model: s.model,
      activity: s.activity,
      healthScore: s.healthScore,
      healthStatus: s.healthStatus,
      healthDiag: s.healthDiag,
      healthDiagKey: s.healthDiagKey,
      sizeBytes: size,
      turnCount: s.turnCount,
      contextPct: s.contextPct,
      lastActiveAt: s.lastActiveAt
    });
  }
  // in-progress conversations first (they're live — you care most now), then worst-health
  const actRank = (a: SessionActivity): number =>
    a === "working" ? 0 : a === "awaiting" ? 1 : 2;
  rows.sort((a, b) => actRank(a.activity) - actRank(b.activity) || a.healthScore - b.healthScore);
  return rows;
}

function activeCodexFiles(): Array<{ file: string; sig: string }> {
  const root = join(HOME, ".codex", "sessions");
  if (!existsSync(root)) return [];
  const out: Array<{ file: string; sig: string }> = [];
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  // sessions/YYYY/MM/DD/*.jsonl — descend newest-first, bounded
  const walk = (dir: string, depth: number): void => {
    if (out.length > 200) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort().reverse();
    } catch {
      return;
    }
    for (const e of entries) {
      const fp = join(dir, e);
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(fp, depth + 1);
      } else if (e.endsWith(".jsonl") && st.mtimeMs >= cutoff) {
        out.push({ file: fp, sig: `${st.mtimeMs}:${st.size}` });
      }
    }
  };
  walk(root, 0);
  return out;
}

let lastResult: SessionScanResult | null = null;
let inFlight: Promise<SessionScanResult> | null = null;

export function getLastSessions(): SessionScanResult | null {
  return lastResult;
}

/** Dedupes concurrent scans — the main-process poller and the renderer's IPC
 * call both run every few seconds; without this they'd double the git/file IO. */
export function scanSessions(): Promise<SessionScanResult> {
  if (inFlight) return inFlight;
  inFlight = doScanSessions().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doScanSessions(): Promise<SessionScanResult> {
  const claudeFiles = activeClaudeFiles();
  const codexFiles = activeCodexFiles();
  const all = [...claudeFiles, ...codexFiles].slice(0, MAX_SESSIONS * 2);

  const sessions: AgentSession[] = [];
  const quotas: AccountQuota[] = [];
  const seenFiles = new Set<string>();

  for (const { file, sig } of all) {
    seenFiles.add(file);
    const isCodex = file.includes(`${join(".codex", "sessions")}`) || file.includes("/.codex/");
    if (isCodex) {
      const cached = cache.get(file);
      if (cached && cached.sig === sig) {
        sessions.push(cached.session);
        continue;
      }
      const r = parseCodex(file);
      if (r) {
        cache.set(file, { sig, session: r.session });
        sessions.push(r.session);
        if (r.quota) quotas.push(r.quota);
      }
    } else {
      const s = readClaudeSession(file, sig); // incremental: only reads new bytes
      if (s) sessions.push(s);
    }
  }

  // evict stale caches
  for (const k of [...cache.keys()]) if (!seenFiles.has(k)) cache.delete(k);
  for (const k of [...claudeStates.keys()]) if (!seenFiles.has(k)) claudeStates.delete(k);

  // git dirty for unique cwds (best-effort)
  const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter((c): c is string => !!c))];
  const dirtyMap = new Map<string, number | null>();
  await Promise.all(uniqueCwds.map(async (cwd) => dirtyMap.set(cwd, await gitDirty(cwd))));
  for (const s of sessions) if (s.cwd) s.gitDirty = dirtyMap.get(s.cwd) ?? null;

  // persist priced sessions to the spend ledger (incremental day buckets)
  const now = Date.now();
  const today = new Date(now);
  const dayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  for (const s of sessions) {
    if (s.costUsd != null) {
      try {
        recordSpend({
          sessionId: s.id,
          agentId: s.agentId,
          model: s.model,
          costUsd: s.costUsd,
          totalTokens: s.totalTokens,
          dayMs,
          ts: now
        });
      } catch {
        /* db optional */
      }
    }
  }

  // codex quota fallback: if no active codex session gave one, read the most
  // recent codex session's last-known rate_limits (abtop-style cache behaviour).
  if (!quotas.some((q) => q.source === "codex")) {
    const fb = newestCodexQuota();
    if (fb) quotas.push(fb);
  }

  // claude account quota (only if a rate file exists — needs statusline hook)
  const claudeQuota = readClaudeQuota();
  if (claudeQuota) quotas.push(claudeQuota);

  // dedupe quotas by source, keep newest
  const quotaBySource = new Map<string, AccountQuota>();
  for (const q of quotas) {
    const prev = quotaBySource.get(q.source);
    if (!prev || (q.updatedAt || 0) > (prev.updatedAt || 0)) quotaBySource.set(q.source, q);
  }

  sessions.sort((a, b) => (b.lastActiveAt || "").localeCompare(a.lastActiveAt || ""));
  sessions.splice(MAX_SESSIONS);

  lastResult = {
    generatedAt: new Date().toISOString(),
    scanned: all.length,
    sessions,
    quotas: [...quotaBySource.values()]
  };
  return lastResult;
}

let codexQuotaCache: { at: number; quota: AccountQuota | null } | null = null;
const CODEX_QUOTA_TTL = 60_000;

function newestCodexQuota(): AccountQuota | null {
  if (codexQuotaCache && Date.now() - codexQuotaCache.at < CODEX_QUOTA_TTL) {
    return codexQuotaCache.quota;
  }
  const root = join(HOME, ".codex", "sessions");
  if (!existsSync(root)) {
    codexQuotaCache = { at: Date.now(), quota: null };
    return null;
  }
  const cands: Array<{ file: string; m: number }> = [];
  const walk = (dir: string, depth: number): void => {
    if (cands.length > 400) return;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort().reverse();
    } catch {
      return;
    }
    for (const e of entries) {
      const fp = join(dir, e);
      let st;
      try {
        st = statSync(fp);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (depth < 3) walk(fp, depth + 1);
      } else if (e.endsWith(".jsonl")) {
        cands.push({ file: fp, m: st.mtimeMs });
      }
    }
  };
  walk(root, 0);
  const quota = cands.length === 0 ? null : parseCodex(cands.reduce((a, b) => (b.m > a.m ? b : a)).file)?.quota ?? null;
  codexQuotaCache = { at: Date.now(), quota };
  return quota;
}

function readClaudeQuota(): AccountQuota | null {
  for (const name of ["rate-limits.json", "abtop-rate-limits.json"]) {
    const path = join(HOME, ".claude", name);
    if (!existsSync(path)) continue;
    try {
      const j = JSON.parse(readFileSync(path, "utf8"));
      const mk = (w: { used_percentage?: number; used_percent?: number; resets_at?: number } | undefined): RateWindow | null =>
        w && (w.used_percentage ?? w.used_percent) != null
          ? { pct: (w.used_percentage ?? w.used_percent) as number, resetsAt: w.resets_at ?? null }
          : null;
      return {
        source: "claude",
        fiveHour: mk(j.five_hour),
        sevenDay: mk(j.seven_day),
        updatedAt: j.updated_at ?? null
      };
    } catch {
      /* ignore */
    }
  }
  return null;
}
