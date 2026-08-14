import type { AgentSession } from "@shared/sessions";

/**
 * Token pricing (USD per 1M tokens), split across the four token classes Claude
 * and Codex report separately. These are PUBLISHED API rates — what the tokens
 * WOULD cost on pay-per-use. For subscription accounts the renderer reframes
 * this as "equivalent value / plan ROI" instead of literal spend.
 *
 * Rates are estimates and drift over time; matched by substring on the model id.
 * Unknown models price to null (shown as "—"), never guessed.
 */
export interface Rate {
  in: number;
  out: number;
  cacheRead: number;
  cacheWrite: number;
}

interface PriceRule {
  match: RegExp;
  rate: Rate;
}

// order matters — more specific patterns first
const RULES: PriceRule[] = [
  // ── Anthropic Claude (cache write = 1.25× input, cache read = 0.1× input) ──
  { match: /opus/, rate: { in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /sonnet/, rate: { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/, rate: { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  // ── OpenAI / Codex (cached input discount; no separate write tier) ──
  { match: /gpt-5|codex|o3|o4|gpt5/, rate: { in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 1.25 } },
  { match: /gpt-4|gpt4/, rate: { in: 2.5, out: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
  // ── Google Gemini ──
  { match: /gemini.*flash|flash/, rate: { in: 0.3, out: 2.5, cacheRead: 0.075, cacheWrite: 0.3 } },
  { match: /gemini/, rate: { in: 1.25, out: 10, cacheRead: 0.31, cacheWrite: 1.25 } }
];

export function rateFor(model: string | null): Rate | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const r of RULES) if (r.match.test(m)) return r.rate;
  return null;
}

/** Cumulative equivalent API cost for a session in USD, or null if unpriceable. */
export function priceSession(s: AgentSession): number | null {
  const r = rateFor(s.model);
  if (!r) return null;
  const usd =
    (s.inputTokens * r.in +
      s.outputTokens * r.out +
      s.cacheRead * r.cacheRead +
      s.cacheCreate * r.cacheWrite) /
    1_000_000;
  return Math.round(usd * 100) / 100;
}
