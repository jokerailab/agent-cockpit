import { join } from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (db) return db;
  const file = join(app.getPath("userData"), "cockpit.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history (
      ts     INTEGER NOT NULL,
      procs  INTEGER NOT NULL,
      cpu    REAL    NOT NULL,
      mem    REAL    NOT NULL,
      ports  INTEGER NOT NULL,
      alerts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_ts ON history(ts);
    CREATE TABLE IF NOT EXISTS session_ledger (
      session_id  TEXT PRIMARY KEY,
      agent_id    TEXT    NOT NULL,
      model       TEXT,
      cost_usd    REAL    NOT NULL,
      total_tokens INTEGER NOT NULL,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_last ON session_ledger(last_seen);
    CREATE TABLE IF NOT EXISTS spend_daily (
      day_ms    INTEGER NOT NULL,
      agent_id  TEXT    NOT NULL,
      cost_usd  REAL    NOT NULL,
      tokens    INTEGER NOT NULL,
      PRIMARY KEY (day_ms, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_spend_day ON spend_daily(day_ms);
  `);
  return db;
}

function conn(): Database.Database {
  return db ?? initDb();
}

/* ── settings (typed JSON key-value) ───────────────────────────── */
export function getSetting<T>(key: string, fallback: T): T {
  const row = conn().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  conn()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, JSON.stringify(value));
}

/* ── history (totals time-series) ──────────────────────────────── */
export interface HistoryPoint {
  ts: number;
  procs: number;
  cpu: number;
  mem: number;
  ports: number;
  alerts: number;
}

export function insertHistory(p: HistoryPoint): void {
  conn()
    .prepare("INSERT INTO history (ts, procs, cpu, mem, ports, alerts) VALUES (?, ?, ?, ?, ?, ?)")
    .run(p.ts, p.procs, p.cpu, p.mem, p.ports, p.alerts);
}

export function getHistory(sinceMs: number, limit = 2000): HistoryPoint[] {
  return conn()
    .prepare("SELECT * FROM history WHERE ts >= ? ORDER BY ts ASC LIMIT ?")
    .all(sinceMs, limit) as HistoryPoint[];
}

/** prune rows older than the retention window (call periodically). */
export function pruneHistory(beforeMs: number): void {
  conn().prepare("DELETE FROM history WHERE ts < ?").run(beforeMs);
}

/* ── spend ledger (incremental, day-bucketed) ──────────────────────
 * session_ledger holds each session's latest CUMULATIVE figures, used only to
 * compute the per-scan DELTA. The delta is added to spend_daily[today], so a
 * long multi-day session contributes the right amount to each day instead of
 * its whole history being re-counted into "today" on every scan.            */
export interface LedgerEntry {
  sessionId: string;
  agentId: string;
  model: string | null;
  costUsd: number;
  totalTokens: number;
  dayMs: number; // start-of-local-day for the bucket this delta lands in
  ts: number;
}

/** Record a session observation: bump the day bucket by the cost/token delta.
 * The FIRST time a session is seen we only set a baseline (no day-bucket bump):
 * the session may have run for days before cockpit started, and that history
 * can't be attributed to any day we observed — counting it would dump the whole
 * lifetime into "today". Only growth seen while cockpit is running counts. */
export function recordSpend(e: LedgerEntry): void {
  const db2 = conn();
  const txn = db2.transaction((x: LedgerEntry) => {
    const prev = db2
      .prepare("SELECT cost_usd, total_tokens FROM session_ledger WHERE session_id = ?")
      .get(x.sessionId) as { cost_usd: number; total_tokens: number } | undefined;

    db2.prepare(
      `INSERT INTO session_ledger
         (session_id, agent_id, model, cost_usd, total_tokens, first_seen, last_seen)
       VALUES (@sessionId, @agentId, @model, @costUsd, @totalTokens, @ts, @ts)
       ON CONFLICT(session_id) DO UPDATE SET
         agent_id = excluded.agent_id,
         model = excluded.model,
         cost_usd = excluded.cost_usd,
         total_tokens = excluded.total_tokens,
         last_seen = excluded.last_seen`
    ).run(x);

    if (!prev) return; // first sighting → baseline only, don't backfill history

    // cumulative counters only grow; clamp guards against reset/reparse
    const dCost = Math.max(0, x.costUsd - prev.cost_usd);
    const dTok = Math.max(0, x.totalTokens - prev.total_tokens);
    if (dCost > 0 || dTok > 0) {
      db2.prepare(
        `INSERT INTO spend_daily (day_ms, agent_id, cost_usd, tokens)
         VALUES (@dayMs, @agentId, @dCost, @dTok)
         ON CONFLICT(day_ms, agent_id) DO UPDATE SET
           cost_usd = cost_usd + @dCost,
           tokens = tokens + @dTok`
      ).run({ dayMs: x.dayMs, agentId: x.agentId, dCost, dTok });
    }
  });
  txn(e);
}

export interface SpendRow {
  agentId: string;
  costUsd: number;
  totalTokens: number;
}

/** Per-agent spend summed over day buckets on/after `sinceMs`. */
export function getSpend(sinceMs: number): SpendRow[] {
  return conn()
    .prepare(
      `SELECT agent_id AS agentId,
              SUM(cost_usd) AS costUsd,
              SUM(tokens) AS totalTokens
         FROM spend_daily
        WHERE day_ms >= ?
        GROUP BY agent_id`
    )
    .all(sinceMs) as SpendRow[];
}

/** drop ledger rows / day buckets older than the retention cutoff. */
export function pruneLedger(beforeMs: number): void {
  conn().prepare("DELETE FROM session_ledger WHERE last_seen < ?").run(beforeMs);
  conn().prepare("DELETE FROM spend_daily WHERE day_ms < ?").run(beforeMs);
}
