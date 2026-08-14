import { describe, expect, it } from "vitest";
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
  type HealthInput
} from "./health";

/** A healthy baseline; each test perturbs exactly one dimension. */
const baseline: HealthInput = {
  turnFlags: [],
  contextPct: 0,
  fileBytes: 0,
  turnCount: 0,
  errorRatio: 0,
  stallStreak: 0,
  compactions: 0
};

/** n turns, `empty` of which produced no visible output. */
function turns(n: number, empty: number, run = 0): Array<[boolean, number]> {
  return Array.from({ length: n }, (_, i) => [i < empty, run] as [boolean, number]);
}

describe("degenerateRun", () => {
  it("returns 0 for normal prose", () => {
    expect(
      degenerateRun("The quick brown fox jumps over the lazy dog while the cat naps nearby today.")
    ).toBe(0);
  });

  it("returns 0 for null and empty input", () => {
    expect(degenerateRun(null)).toBe(0);
    expect(degenerateRun("")).toBe(0);
    expect(degenerateRun("   ")).toBe(0);
  });

  it("ignores texts under the 15-token floor", () => {
    // 14 identical tokens would trip the run rule, but the sample is too small
    expect(degenerateRun("court ".repeat(14))).toBe(0);
  });

  it("does not fire at a run of 7 (just below threshold)", () => {
    const text = `${"court ".repeat(7)}${"varied words here to pad the token count out past fifteen"}`;
    expect(degenerateRun(text)).toBe(0);
  });

  it("fires at a run of exactly 8 (threshold)", () => {
    const text = `${"court ".repeat(8)}${"varied words here to pad the token count out past fifteen"}`;
    expect(degenerateRun(text)).toBe(8);
  });

  it("reports the magnitude of a long run", () => {
    expect(degenerateRun("court ".repeat(500))).toBe(500);
  });

  it("catches interleaved low-diversity repetition (a b a b …)", () => {
    // no run >= 8, but only 2 unique tokens across 40 → below the 10% diversity floor
    expect(degenerateRun("a b ".repeat(20))).toBe(40);
  });

  it("does not flag diverse text that merely repeats a few words", () => {
    const text =
      "we should refactor the parser and then refactor the writer and finally refactor the tests properly";
    expect(degenerateRun(text)).toBe(0);
  });
});

describe("scoreHealth · penalties", () => {
  it("scores a clean session at 100 with no diagnosis", () => {
    const h = scoreHealth(baseline);
    expect(h.score).toBe(100);
    expect(h.status).toBe("healthy");
    expect(h.diagKey).toBeNull();
    expect(h.diagParams).toEqual({});
  });

  it("charges 35 for a blown context window", () => {
    expect(scoreHealth({ ...baseline, contextPct: 0.96 }).score).toBe(65);
  });

  it("charges 20 for a tight context window", () => {
    expect(scoreHealth({ ...baseline, contextPct: 0.86 }).score).toBe(80);
  });

  it("applies the context bands at exactly 0.95 and 0.85", () => {
    expect(scoreHealth({ ...baseline, contextPct: 0.95 }).score).toBe(65); // blown
    expect(scoreHealth({ ...baseline, contextPct: 0.85 }).score).toBe(80); // tight
    expect(scoreHealth({ ...baseline, contextPct: 0.84 }).score).toBe(100); // clear
  });

  it("does not judge spinning below the 6-turn sample floor", () => {
    // 5 turns, all empty — ratio is 1.0 but the sample is too small to trust
    const h = scoreHealth({ ...baseline, turnFlags: turns(5, 5) });
    expect(h.score).toBe(100);
    expect(h.diagKey).toBeNull();
  });

  it("charges 30 for severe spinning and 15 for mild", () => {
    expect(scoreHealth({ ...baseline, turnFlags: turns(10, 5) }).score).toBe(70); // 50% empty
    expect(scoreHealth({ ...baseline, turnFlags: turns(10, 3) }).score).toBe(85); // 30% empty
    expect(scoreHealth({ ...baseline, turnFlags: turns(10, 2) }).score).toBe(100); // 20%, not over
  });

  it("charges 50 for degeneration, the heaviest single penalty", () => {
    expect(scoreHealth({ ...baseline, turnFlags: [[false, 13441]] }).score).toBe(50);
  });

  it("charges 15 for stalling and 15 for a high error ratio", () => {
    expect(scoreHealth({ ...baseline, stallStreak: 3 }).score).toBe(85);
    expect(scoreHealth({ ...baseline, stallStreak: 2 }).score).toBe(100); // below threshold
    expect(scoreHealth({ ...baseline, errorRatio: 0.16 }).score).toBe(85);
    expect(scoreHealth({ ...baseline, errorRatio: 0.15 }).score).toBe(100); // not over
  });

  it("charges 10 for churn, 10 for bloat and 8 for turn count", () => {
    expect(scoreHealth({ ...baseline, compactions: 3 }).score).toBe(90);
    expect(scoreHealth({ ...baseline, fileBytes: 11_000_000 }).score).toBe(90);
    expect(scoreHealth({ ...baseline, turnCount: 1501 }).score).toBe(92);
  });

  it("charges 5 for a mid-sized file without attaching a label", () => {
    const h = scoreHealth({ ...baseline, fileBytes: 6_000_000 });
    expect(h.score).toBe(95);
    expect(h.diagKey).toBeNull();
  });

  it("clamps the score at 0 rather than going negative", () => {
    const h = scoreHealth({
      contextPct: 1,
      turnFlags: turns(20, 20, 9999),
      fileBytes: 50_000_000,
      turnCount: 5000,
      errorRatio: 1,
      stallStreak: 20,
      compactions: 20
    });
    expect(h.score).toBe(0);
    expect(h.status).toBe("failing");
  });

  it("maps score 70 to healthy and below it to degrading", () => {
    expect(scoreHealth({ ...baseline, turnFlags: turns(10, 5) }).status).toBe("healthy"); // 70
    expect(scoreHealth({ ...baseline, turnFlags: turns(10, 5), turnCount: 1501 }).status).toBe(
      "degrading"
    ); // 62
  });

  it("maps score 40 to degrading and below it to failing", () => {
    // 30 (spin) + 15 (stall) + 15 (errors) = 60 → exactly 40
    const at40 = scoreHealth({
      ...baseline,
      turnFlags: turns(10, 5),
      stallStreak: 3,
      errorRatio: 0.2
    });
    expect(at40.score).toBe(40);
    expect(at40.status).toBe("degrading");

    const below = scoreHealth({ ...baseline, contextPct: 1, turnFlags: [[false, 8]] });
    expect(below.score).toBe(15);
    expect(below.status).toBe("failing");
  });
});

/**
 * The reported diagnosis is the single largest penalty, so these cases stack a
 * fixed floor of secondary noise (churn + bloat + turn count = 28 points) to
 * push the verdict out of "healthy", then assert which rule takes the headline.
 */
describe("scoreHealth · headline diagnosis", () => {
  /** 28 points of low-grade penalties, none of which can win the headline. */
  const noise: Partial<HealthInput> = {
    compactions: 3, // 10
    fileBytes: 11_000_000, // 10
    turnCount: 1501 // 8
  };
  const withNoise = (over: Partial<HealthInput>): HealthInput => ({
    ...baseline,
    ...noise,
    ...over
  });

  it("reports a blown context", () => {
    const h = scoreHealth(withNoise({ contextPct: 0.96 }));
    expect(h.diagKey).toBe("contextBlown");
    expect(h.status).toBe("failing"); // 100 - 28 - 35 = 37
  });

  it("reports a tight context", () => {
    expect(scoreHealth(withNoise({ contextPct: 0.86 })).diagKey).toBe("contextTight");
  });

  it("reports severe and mild spinning", () => {
    expect(scoreHealth(withNoise({ turnFlags: turns(10, 5) })).diagKey).toBe("spinningBad");
    expect(scoreHealth(withNoise({ turnFlags: turns(10, 3) })).diagKey).toBe("spinning");
  });

  it("reports degeneration with the run length attached", () => {
    const h = scoreHealth(withNoise({ turnFlags: [[false, 13441]] }));
    expect(h.diagKey).toBe("degenerate");
    expect(h.diagParams).toEqual({ run: 13441 });
  });

  it("reports stalling with the nudge count attached", () => {
    const h = scoreHealth(withNoise({ stallStreak: 4 }));
    expect(h.diagKey).toBe("stalled");
    expect(h.diagParams).toEqual({ count: 4 });
  });

  it("reports a high error ratio as a rounded percentage", () => {
    const h = scoreHealth(withNoise({ errorRatio: 0.224 }));
    expect(h.diagKey).toBe("errorProne");
    expect(h.diagParams).toEqual({ pct: 22 });
  });

  it("lets degeneration outrank a blown context when both fire", () => {
    // 50 > 35: repetition is the thing you must act on, not the full window
    const h = scoreHealth({
      ...baseline,
      contextPct: 0.99,
      turnFlags: turns(10, 6, 40),
      stallStreak: 5
    });
    expect(h.diagKey).toBe("degenerate");
    expect(h.status).toBe("failing");
  });

  it("keeps the earlier rule when two penalties tie", () => {
    // spinning (15) and stalled (15) tie; spinning is evaluated first
    const h = scoreHealth(withNoise({ turnFlags: turns(10, 3), stallStreak: 3 }));
    expect(h.diagKey).toBe("spinning");
  });

  it("never lets a secondary signal become the headline on its own", () => {
    // churn + bloat + turn count is the heaviest all-secondary load possible
    // (28 points) and still lands at 72 → healthy → no diagnosis at all.
    // These rules shade the score; they never diagnose.
    const h = scoreHealth(withNoise({}));
    expect(h.score).toBe(72);
    expect(h.status).toBe("healthy");
    expect(h.diagKey).toBeNull();
  });

  it("suppresses any diagnosis while the verdict is healthy", () => {
    const h = scoreHealth({ ...baseline, compactions: 5 });
    expect(h.score).toBe(90);
    expect(h.status).toBe("healthy");
    expect(h.diagKey).toBeNull();
    expect(h.diagParams).toEqual({});
  });
});

describe("modelLimit", () => {
  it("detects the 1M context tier from a [1m] suffix", () => {
    expect(modelLimit("claude-opus-5[1m]")).toBe(1_000_000);
  });

  it("gives OpenAI models a 272k window", () => {
    for (const m of ["gpt-5", "codex-mini", "o3", "o4-mini"]) {
      expect(modelLimit(m)).toBe(272_000);
    }
  });

  it("gives Gemini a 1M window", () => {
    expect(modelLimit("gemini-2.5-pro")).toBe(1_000_000);
  });

  it("falls back to 200k for unknown and missing models", () => {
    expect(modelLimit("claude-sonnet-5")).toBe(200_000);
    expect(modelLimit("some-unreleased-model")).toBe(200_000);
    expect(modelLimit(null)).toBe(200_000);
  });
});

describe("statusFrom", () => {
  const now = 1_700_000_000_000;

  it("is active under a minute", () => {
    expect(statusFrom(now - 59_000, now)).toBe("active");
  });

  it("is recent between one and ten minutes", () => {
    expect(statusFrom(now - 60_000, now)).toBe("recent");
    expect(statusFrom(now - 9 * 60_000, now)).toBe("recent");
  });

  it("is idle past ten minutes", () => {
    expect(statusFrom(now - 10 * 60_000, now)).toBe("idle");
  });
});

describe("burnRate", () => {
  it("needs at least two samples", () => {
    expect(burnRate([])).toBe(0);
    expect(burnRate([[0, 5]])).toBe(0);
  });

  it("computes USD per minute across the window", () => {
    expect(burnRate([[0, 1], [120_000, 5]])).toBe(2); // $4 over 2 minutes
  });

  it("guards against a zero-width window", () => {
    expect(burnRate([[1000, 1], [1000, 9]])).toBe(0);
  });

  it("never reports a negative rate when cumulative cost regresses", () => {
    expect(burnRate([[0, 10], [60_000, 4]])).toBe(0);
  });
});

describe("computeActivity", () => {
  const now = 1_700_000_000_000;
  const fresh = { mtimeMs: now - 1000 };

  it("parks a session untouched for over 15 minutes", () => {
    const a = computeActivity(
      { mtimeMs: now - 16 * 60_000, lastMsgRole: "user", lastAssistantStop: null },
      now
    );
    expect(a).toBe("idle");
  });

  it("is working when the user spoke last (agent owes a reply)", () => {
    expect(
      computeActivity({ ...fresh, lastMsgRole: "user", lastAssistantStop: "end_turn" }, now)
    ).toBe("working");
  });

  it("is working while a tool call is outstanding", () => {
    expect(
      computeActivity({ ...fresh, lastMsgRole: "assistant", lastAssistantStop: "tool_use" }, now)
    ).toBe("working");
  });

  it("is awaiting after the agent ends its turn", () => {
    expect(
      computeActivity({ ...fresh, lastMsgRole: "assistant", lastAssistantStop: "end_turn" }, now)
    ).toBe("awaiting");
  });

  it("is awaiting on a truncated or unknown turn boundary", () => {
    expect(
      computeActivity({ ...fresh, lastMsgRole: "assistant", lastAssistantStop: "max_tokens" }, now)
    ).toBe("awaiting");
    expect(
      computeActivity({ ...fresh, lastMsgRole: "assistant", lastAssistantStop: null }, now)
    ).toBe("awaiting");
  });
});

describe("content-block helpers", () => {
  it("extracts a plain string body", () => {
    expect(extractText("hello")).toBe("hello");
  });

  it("extracts the first non-blank text block", () => {
    expect(
      extractText([
        { type: "text", text: "   " },
        { type: "text", text: "real content" }
      ])
    ).toBe("real content");
  });

  it("returns null when no text block is present", () => {
    expect(extractText([{ type: "tool_use", name: "Bash" }])).toBeNull();
    expect(extractText(null)).toBeNull();
    expect(extractText(42)).toBeNull();
  });

  it("detects tool_use, tool_result and errored tool results", () => {
    expect(hasToolUse([{ type: "tool_use" }])).toBe(true);
    expect(hasToolUse([{ type: "text", text: "x" }])).toBe(false);
    expect(hasToolResult([{ type: "tool_result" }])).toBe(true);
    expect(hasToolError([{ type: "tool_result", is_error: true }])).toBe(true);
    expect(hasToolError([{ type: "tool_result", is_error: false }])).toBe(false);
    expect(hasToolError([{ type: "tool_result" }])).toBe(false);
  });

  it("survives malformed blocks without throwing", () => {
    expect(hasToolUse([null, undefined, "str", 7])).toBe(false);
    expect(hasToolResult("not an array")).toBe(false);
  });
});
