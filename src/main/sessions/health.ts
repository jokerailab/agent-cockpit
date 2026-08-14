/**
 * Session health scoring — pure functions, no IO, no Electron.
 *
 * Split out of engine.ts so the scoring model can be unit-tested in plain Node:
 * engine.ts reaches store/db.ts, which imports `electron`, which cannot load
 * outside an Electron runtime.
 *
 * Every rule here is calibrated against real rotten sessions. See
 * docs/HEALTH-MODEL.md for the derivation and the known false-positive edges.
 */
import type { HealthDiagKey, SessionActivity, SessionStatus } from "@shared/sessions";

/* ── content-block helpers (Claude jsonl message shapes) ───────── */

export function extractText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
        const t = (block as { text?: string }).text;
        if (t && t.trim()) return t;
      }
    }
  }
  return null;
}

export function hasToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result"
    )
  );
}

export function hasToolUse(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_use")
  );
}

export function hasToolError(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (b) =>
        b &&
        typeof b === "object" &&
        (b as { type?: string }).type === "tool_result" &&
        (b as { is_error?: boolean }).is_error === true
    )
  );
}

/* ── scalar derivations ────────────────────────────────────────── */

export function modelLimit(model: string | null): number {
  if (!model) return 200_000;
  const m = model.toLowerCase();
  if (/\[1m\]|-1m\b|1m\b/.test(m)) return 1_000_000;
  if (m.includes("gpt") || m.includes("codex") || m.includes("o3") || m.includes("o4"))
    return 272_000;
  if (m.includes("gemini")) return 1_000_000;
  return 200_000;
}

export function statusFrom(lastMs: number, now: number = Date.now()): SessionStatus {
  const age = now - lastMs;
  if (age < 60_000) return "active";
  if (age < 10 * 60_000) return "recent";
  return "idle";
}

/** USD/min burn rate from cumulative-cost samples: [wallMs, cumulativeCostUsd]. */
export function burnRate(samples: Array<[number, number]>): number {
  if (samples.length < 2) return 0;
  const [t0, c0] = samples[0]!;
  const [t1, c1] = samples[samples.length - 1]!;
  const mins = (t1 - t0) / 60000;
  if (mins <= 0) return 0;
  return Math.max(0, (c1 - c0) / mins);
}

/**
 * Degeneration magnitude for an assistant text: the longest run of the same
 * whitespace-delimited token, plus a low-diversity fallback for interleaved
 * repetition. Calibrated on a real "court court court…" session (run 13441).
 * Returns 0 for normal text.
 */
export function degenerateRun(text: string | null): number {
  if (!text) return 0;
  const toks = text.trim().split(/\s+/).filter(Boolean);
  if (toks.length < 15) return 0;
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < toks.length; i++) {
    if (toks[i] === toks[i - 1]) {
      run++;
      if (run > maxRun) maxRun = run;
    } else run = 1;
  }
  if (maxRun >= 8) return maxRun;
  const uniq = new Set(toks).size;
  if (toks.length >= 20 && uniq / toks.length < 0.1) return toks.length; // a b a b a b …
  return 0;
}

/* ── turn-level activity ───────────────────────────────────────── */

/** The subset of parse state that determines activity. */
export interface ActivitySignals {
  /** mtime of the session file — how fresh the conversation is */
  mtimeMs: number;
  lastMsgRole: "assistant" | "user" | null;
  /** stop_reason of the most recent assistant message */
  lastAssistantStop: string | null;
}

/** Derive turn-level activity from the last message + file freshness. */
export function computeActivity(st: ActivitySignals, now: number = Date.now()): SessionActivity {
  const age = now - (st.mtimeMs || now);
  if (age > 15 * 60 * 1000) return "idle"; // parked
  if (st.lastMsgRole === "user") return "working"; // agent's turn (prompt or tool_result)
  if (st.lastAssistantStop === "tool_use") return "working"; // awaiting tool result
  if (st.lastAssistantStop === "end_turn") return "awaiting"; // your move
  return "awaiting"; // max_tokens / unknown turn boundary
}

/* ── health scoring ────────────────────────────────────────────── */

/**
 * Dominant-problem identifier. Kept as a stable key rather than a rendered
 * string so the UI can branch on it and i18n can translate it. Renderer logic
 * MUST switch on this, never on the translated `healthDiag` text.
 * The union itself lives in @shared/sessions (it crosses the IPC boundary).
 */
export type DiagKey = HealthDiagKey;

export interface Health {
  score: number;
  status: "healthy" | "degrading" | "failing";
  /** worst-penalty problem; null when healthy or when no rule carried a label */
  diagKey: DiagKey | null;
  /** interpolation values for the diagnosis string (e.g. { run: 8420 }) */
  diagParams: Record<string, number>;
}

export interface HealthInput {
  /** recent assistant turns: [emptyOutput, degenerateRun] */
  turnFlags: Array<[boolean, number]>;
  /** 0..1 context window usage */
  contextPct: number;
  /** session file size in bytes */
  fileBytes: number;
  turnCount: number;
  /** 0..1 share of recent tool results that errored */
  errorRatio: number;
  /** consecutive short "continue"-style nudges */
  stallStreak: number;
  /** count of compact_boundary events */
  compactions: number;
}

/** Minimum recent-turn sample size before spinning is judged at all. */
const SPIN_MIN_SAMPLE = 6;

/**
 * Composite health from the recent-turn ring + context + bloat. Penalties are
 * calibrated on real rotten sessions (30% empty spin; "court" run of 13441).
 *
 * The reported diagnosis is the single largest penalty, not a list: when a
 * session is both context-tight and degenerate, "degenerate" is what you must
 * act on. Ties go to the rule evaluated first (strict `>` comparison).
 */
export function scoreHealth(input: HealthInput): Health {
  const { turnFlags, contextPct, fileBytes, turnCount, errorRatio, stallStreak, compactions } =
    input;

  let score = 100;
  let worst = 0;
  let diagKey: DiagKey | null = null;
  let diagParams: Record<string, number> = {};

  const pen = (amt: number, key: DiagKey | null, params: Record<string, number> = {}): void => {
    score -= amt;
    if (key && amt > worst) {
      worst = amt;
      diagKey = key;
      diagParams = params;
    }
  };

  if (contextPct >= 0.95) pen(35, "contextBlown");
  else if (contextPct >= 0.85) pen(20, "contextTight");

  const n = turnFlags.length;
  if (n >= SPIN_MIN_SAMPLE) {
    const emptyRatio = turnFlags.filter((f) => f[0]).length / n;
    if (emptyRatio > 0.4) pen(30, "spinningBad");
    else if (emptyRatio > 0.2) pen(15, "spinning");
  }

  const worstRun = turnFlags.reduce((m, f) => Math.max(m, f[1]), 0);
  if (worstRun >= 8) pen(50, "degenerate", { run: worstRun });

  // secondary signals — other ways a session dies
  if (stallStreak >= 3) pen(15, "stalled", { count: stallStreak });
  if (errorRatio > 0.15) pen(15, "errorProne", { pct: Math.round(errorRatio * 100) });
  if (compactions >= 3) pen(10, "churning", { count: compactions });
  if (fileBytes > 10_000_000) pen(10, "bloated");
  else if (fileBytes > 5_000_000) pen(5, null); // penalised, but not the headline
  if (turnCount > 1500) pen(8, "tooManyTurns");

  score = Math.max(0, Math.min(100, Math.round(score)));
  const status = score >= 70 ? "healthy" : score >= 40 ? "degrading" : "failing";
  return {
    score,
    status,
    diagKey: status === "healthy" ? null : diagKey,
    diagParams: status === "healthy" ? {} : diagParams
  };
}
