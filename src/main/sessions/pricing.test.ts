import { describe, expect, it } from "vitest";
import { priceSession, rateFor } from "./pricing";
import type { AgentSession } from "@shared/sessions";

/** Minimal session shell; each test sets only the fields pricing reads. */
function session(over: Partial<AgentSession>): AgentSession {
  return {
    id: "s1",
    agentId: "claude",
    project: "demo",
    cwd: null,
    model: null,
    status: "active",
    activity: "working",
    contextTokens: 0,
    contextLimit: 200_000,
    contextPct: 0,
    compactionRisk: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheCreate: 0,
    totalTokens: 0,
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
    lastActiveAt: null,
    ...over
  };
}

describe("rateFor", () => {
  it("prices the Anthropic tiers", () => {
    expect(rateFor("claude-opus-5")).toEqual({
      in: 15,
      out: 75,
      cacheRead: 1.5,
      cacheWrite: 18.75
    });
    expect(rateFor("claude-sonnet-5")?.in).toBe(3);
    expect(rateFor("claude-haiku-4-5-20251001")?.in).toBe(1);
  });

  it("prices the OpenAI tiers", () => {
    expect(rateFor("gpt-5")?.out).toBe(10);
    expect(rateFor("codex-mini")?.in).toBe(1.25);
    expect(rateFor("o3")?.in).toBe(1.25);
    expect(rateFor("gpt-4o")?.in).toBe(2.5);
  });

  it("matches case-insensitively", () => {
    expect(rateFor("CLAUDE-OPUS-5")?.in).toBe(15);
  });

  it("prefers the flash rate over the generic Gemini rate", () => {
    // rule order matters: gemini-*-flash must not fall through to the pro rate
    expect(rateFor("gemini-2.5-flash")?.in).toBe(0.3);
    expect(rateFor("gemini-2.5-pro")?.in).toBe(1.25);
  });

  it("returns null rather than guessing an unknown model", () => {
    expect(rateFor("some-unreleased-model")).toBeNull();
    expect(rateFor(null)).toBeNull();
    expect(rateFor("")).toBeNull();
  });
});

describe("priceSession", () => {
  it("sums all four token classes at their own rates", () => {
    // opus: 1M in ($15) + 1M out ($75) + 1M cache read ($1.50) + 1M cache write ($18.75)
    const cost = priceSession(
      session({
        model: "claude-opus-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheRead: 1_000_000,
        cacheCreate: 1_000_000
      })
    );
    expect(cost).toBe(110.25);
  });

  it("rounds to cents", () => {
    const cost = priceSession(session({ model: "claude-sonnet-5", outputTokens: 12_345 }));
    expect(cost).toBe(0.19); // 12345 * 15 / 1e6 = 0.185175
  });

  it("returns null for an unpriceable model instead of zero", () => {
    // a zero would read as "this session was free", which is a different claim
    expect(priceSession(session({ model: "mystery-model", outputTokens: 5_000_000 }))).toBeNull();
    expect(priceSession(session({ model: null, outputTokens: 5_000_000 }))).toBeNull();
  });

  it("prices a zero-token session at zero, not null", () => {
    expect(priceSession(session({ model: "claude-opus-5" }))).toBe(0);
  });

  it("weights cache reads far below fresh input", () => {
    const fresh = priceSession(session({ model: "claude-opus-5", inputTokens: 1_000_000 }))!;
    const cached = priceSession(session({ model: "claude-opus-5", cacheRead: 1_000_000 }))!;
    expect(cached).toBeLessThan(fresh);
    expect(cached / fresh).toBeCloseTo(0.1, 5); // cache read is 10% of input
  });
});
