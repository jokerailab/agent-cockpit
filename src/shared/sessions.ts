/** Agent session intelligence — read from agent session logs (inspired by abtop). */

/**
 * Stable identifier for the dominant health problem. UI logic MUST branch on
 * this key, never on the rendered `healthDiag` string (that one is translated,
 * so substring matching against it breaks under any non-default locale).
 * Defined in main/sessions/health.ts; mirrored here as the wire contract.
 */
export type HealthDiagKey =
  | "contextBlown"
  | "contextTight"
  | "spinningBad"
  | "spinning"
  | "degenerate"
  | "stalled"
  | "errorProne"
  | "churning"
  | "bloated"
  | "tooManyTurns";

export type SessionStatus = "active" | "recent" | "idle";

/**
 * Turn-level activity — what the conversation is doing right now:
 *  - working:  agent is mid-turn (generating / running a tool, awaiting tool result)
 *  - awaiting: agent finished its turn (end_turn) — ball is in your court
 *  - idle:     parked / no recent activity (effectively a done conversation)
 */
export type SessionActivity = "working" | "awaiting" | "idle";

export interface AgentSession {
  id: string;
  agentId: string; // "claude" | "codex" | ...
  project: string; // basename of cwd
  cwd: string | null;
  model: string | null;
  status: SessionStatus;
  /** turn-level activity (working / awaiting / idle) */
  activity: SessionActivity;
  /** current context footprint in tokens (prompt + cache) */
  contextTokens: number;
  /** model context window limit */
  contextLimit: number;
  /** 0..1 */
  contextPct: number;
  compactionRisk: boolean;
  /** cumulative tokens this session */
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  totalTokens: number;
  /** cumulative equivalent API cost in USD (published rates); null if model unpriceable */
  costUsd: number | null;
  /** recent burn rate in USD/min (equivalent), over a rolling window; 0 if idle/unknown */
  costRate: number;
  /** session health 0..100 (100 = healthy). Detects context blowout, spinning
   * (empty turns) and degeneration (token repetition) — is this session still usable? */
  healthScore: number;
  healthStatus: "healthy" | "degrading" | "failing";
  /** dominant problem, rendered for display in the active locale; null when healthy */
  healthDiag: string | null;
  /** dominant problem as a stable key — branch on this, not on healthDiag */
  healthDiagKey: HealthDiagKey | null;
  /** output tokens per minute over the recent window */
  tokenRate: number;
  turnCount: number;
  task: string | null;
  gitBranch: string | null;
  gitDirty: number | null;
  messageCount: number;
  lastActiveAt: string | null;
}

export interface RateWindow {
  pct: number; // 0..100 used
  resetsAt: number | null; // epoch seconds
}

/** Account-level rate-limit quota (5h / 7d windows). */
export interface AccountQuota {
  source: string; // "claude" | "codex"
  fiveHour: RateWindow | null;
  sevenDay: RateWindow | null;
  updatedAt: number | null;
}

export interface SessionScanResult {
  generatedAt: string;
  scanned: number;
  sessions: AgentSession[];
  quotas: AccountQuota[];
}

/** One row in the full-fleet health audit — a health verdict over every recent
 * Claude session (not just the live ones), so you can triage the graveyard. */
export interface SessionAudit {
  id: string;
  project: string;
  agentId: string;
  model: string | null;
  activity: SessionActivity;
  healthScore: number;
  healthStatus: "healthy" | "degrading" | "failing";
  healthDiag: string | null;
  healthDiagKey: HealthDiagKey | null;
  sizeBytes: number;
  turnCount: number;
  contextPct: number;
  lastActiveAt: string | null;
}

/** State of the Claude statusline hook that feeds account quota data. */
export interface ClaudeHookStatus {
  /** the cockpit statusline script is present on disk */
  scriptExists: boolean;
  /** whether settings.json points statusLine at our script, someone else's, or nothing */
  wired: "ours" | "other" | "none";
  /** rate-limits.json exists (quota data is flowing) */
  hasData: boolean;
}

/** Spend rolled up over a time window. */
export interface SpendBucket {
  total: number; // USD
  byAgent: Record<string, number>; // USD per agent id
  tokens: number;
}

export interface SpendSummary {
  today: SpendBucket;
  week: SpendBucket;
  month: SpendBucket;
  all: SpendBucket;
}

export interface ClaudeHookInstallResult {
  ok: boolean;
  status: ClaudeHookStatus;
  /** an unrelated statusLine already exists — install refused to overwrite it */
  conflict?: boolean;
  error?: string;
}
