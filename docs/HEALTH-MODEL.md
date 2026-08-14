# The session health model

Agent Cockpit scores every recent Claude Code session from 0 to 100 and names the
single problem you should act on. This document is the whole model: where the
signals come from, what each rule costs, how it was calibrated, and where it is
known to be wrong.

Implementation: [`src/main/sessions/health.ts`](../src/main/sessions/health.ts).
Tests: [`health.test.ts`](../src/main/sessions/health.test.ts) (52 cases).

---

## Why score a session at all

A coding agent does not fail loudly. It fails by *slowly becoming useless*: it
starts replying without producing anything, or repeating one token for thousands
of tokens, or burning its context window on a transcript it can no longer use.
From the outside all three look the same, which is a session that is "still
running".

The expensive mistake is not noticing. You keep typing "continue", each turn
costs real money, and the transcript rots further. The right move is usually to
abandon the session and hand the task to a fresh one, but that only works if you
know *which* session is rotten and *why*.

So the model does not try to judge answer quality. It detects specific,
mechanically observable failure modes and tells you what to do about each.

---

## Where the signals come from

Claude Code appends one JSON object per event to
`~/.claude/projects/<slug>/<session-id>.jsonl`. The parser reads only the bytes
appended since its last pass (see [ARCHITECTURE.md](./ARCHITECTURE.md)) and folds
each record into a running accumulator.

| Signal | Source in the jsonl |
| --- | --- |
| Context footprint | Most recent `assistant.message.usage`: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` |
| Empty turn | An `assistant` message whose content has no non-blank `text` block **and** no `tool_use` block |
| Token repetition | Longest run of an identical whitespace-delimited token in an assistant `text` block |
| Tool error | `user` message containing a `tool_result` with `is_error: true` |
| Nudge streak | Consecutive short `user` messages matching a "continue"-style pattern, with no `tool_result` |
| Compaction count | `system` records with `subtype: "compact_boundary"` |
| File size, turn count | `statSync` on the file; count of assistant messages |

Only the last 30 assistant turns are kept for the ratio-based signals, so the
score reflects how the session is behaving *now*, not how it started.

---

## The rules

Each rule subtracts from a starting score of 100.

| # | Condition | Penalty | Diagnosis key |
| --- | --- | --- | --- |
| 1 | `contextPct >= 0.95` | 35 | `contextBlown` |
| 2 | `contextPct >= 0.85` (and < 0.95) | 20 | `contextTight` |
| 3 | Empty-turn ratio > 0.40, sample ≥ 6 | 30 | `spinningBad` |
| 4 | Empty-turn ratio > 0.20 (and ≤ 0.40), sample ≥ 6 | 15 | `spinning` |
| 5 | Longest token run ≥ 8 | 50 | `degenerate` |
| 6 | Nudge streak ≥ 3 | 15 | `stalled` |
| 7 | Tool-error ratio > 0.15 (sample ≥ 8) | 15 | `errorProne` |
| 8 | Compactions ≥ 3 | 10 | `churning` |
| 9 | File > 10 MB | 10 | `bloated` |
| 10 | File > 5 MB (and ≤ 10 MB) | 5 | *(none)* |
| 11 | Turn count > 1500 | 8 | `tooManyTurns` |

Final score is clamped to 0–100, then mapped:

| Score | Status | Meaning |
| --- | --- | --- |
| 70–100 | `healthy` | Usable. No diagnosis is reported at all. |
| 40–69 | `degrading` | Works, but plan an exit. |
| 0–39 | `failing` | Stop feeding it. Hand over. |

---

## How the headline is chosen

Several rules fire at once on a rotten session. Reporting all of them is noise,
so the model reports **the single largest penalty** and calls it the diagnosis.

Degeneration (50) outranks a blown context (35) deliberately: if the model is
emitting `court court court…`, the fact that the window is also full is not what
you need to hear. Ties go to whichever rule is evaluated first, in table order.

Two consequences worth knowing:

- **A healthy verdict suppresses the diagnosis entirely.** A session at 90 points
  with 5 compactions is not shown as "churning" — it is simply healthy. The
  penalty shaded the score and nothing more.
- **Rules 8 through 11 can never be the headline on their own.** Their combined
  maximum is 28 points, which lands at 72 and is still `healthy`. They only ever
  surface as the diagnosis alongside a heavier rule that pushed the score down,
  and even then the heavier rule wins the headline. They are score modifiers, not
  diagnoses. This is asserted in the test suite so it stays true.

---

## Calibration

The thresholds are not guesses, but they are also not statistics. Each came from
inspecting real sessions on a working machine and asking what value would have
caught the failure without flagging the healthy sessions around it.

**Degeneration, run ≥ 8** — calibrated on a real Claude session that emitted the
word `court` 13,441 times consecutively. A run of 8 is already far outside normal
prose; the highest run observed in a healthy session was 4 (a list of repeated
values). The 15-token floor exists because short replies like "ok ok ok" are
legitimate.

**Interleaved repetition fallback** — the same failure sometimes alternates
(`a b a b a b …`) and produces no long run. So a text of ≥ 20 tokens with unique
token diversity below 10% is also treated as degenerate.

**Empty-turn ratio 0.20 / 0.40** — measured against a session that had gone into
a spin where roughly 30% of assistant turns produced neither text nor a tool
call. 0.20 was the highest ratio seen in sessions that were still making
progress.

**Sample floor of 6 turns** — without it, a brand-new session whose first two
turns are tool-only registers a 100% empty ratio and gets branded as spinning.

**The 1M context probe** — the `model` field in the jsonl carries no `[1m]`
suffix (it reads e.g. `claude-opus-4-7`), so the model name alone cannot tell you
the window size. But a 200k-window model *cannot* exceed 200k, it compacts first.
So an observed footprint above 200k proves a 1M-tier window. Without this probe
the UI reported context usage of "150%". Verified 2026-06; there is a comment on
the line saying so, because it looks removable and is not.

**Tool-error ratio 0.15** — permission prompts and retried edits mean a healthy
session still errors occasionally. 15% was above the normal band.

---

## Known limits and false positives

The model is a smoke detector, not a diagnosis. Where it is weakest:

- **Legitimate repetition reads as degeneration.** An agent asked to generate a
  large fixture, ASCII art, or a table with a repeated column will trip rule 5.
  This is the most likely false positive.
- **Long tool-only stretches read as spinning.** An agent doing a long mechanical
  refactor emits many `tool_use` turns. Those are *not* counted as empty (the
  `hasToolUse` check exists for exactly this), but an agent that thinks silently
  between tool calls can still push the ratio up.
- **Nudge detection is pattern-based.** The regex covers common English and
  Chinese continuation phrases. A user who nudges with anything else gets no
  `stalled` signal; a user who legitimately says "next" three times in a row gets
  a false one.
- **Turn count and file size are proxies for age, not health.** A 2000-turn
  session that is working fine loses 8 points it does not deserve. This is why
  they are capped low and cannot become the headline.
- **Scores are not comparable across models.** Context percentages depend on the
  detected window size, and that detection is heuristic for anything that is not
  Claude or an obvious OpenAI/Gemini identifier.
- **Codex sessions are not scored at all.** Codex writes a different log shape:
  the cockpit reads its cumulative `token_count` and `rate_limits` from the tail
  of the file, which gives context and cost but none of the per-turn signals the
  health model needs. Rather than emit a fabricated 100, Codex sessions are shown
  with monitoring data and no health verdict.

If a rule misfires on your workload, the thresholds are all named constants at
the top of `health.ts`. Changing one should come with a test case describing the
session that motivated it.

---

## Extending the model

To add a signal:

1. Accumulate it in `ClaudeState` inside `foldClaudeLine` (`sessions/engine.ts`).
2. Add the field to `HealthInput` and a rule to `scoreHealth` (`health.ts`).
3. Add the key to `HealthDiagKey` in `shared/sessions.ts`.
4. Add `health.diag.<key>` to **both** `shared/i18n/en.ts` and `zh-CN.ts`. A
   missing translation fails `npm run typecheck`.
5. If the diagnosis needs bespoke advice, extend the `switch` in `handleAdvice`
   (`App.tsx`). Branch on the key, never on the rendered text.
6. Add test cases for the penalty value *and* for whether the rule can take the
   headline.
