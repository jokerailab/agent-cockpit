# Architecture

Agent Cockpit is an Electron app with three build targets and one rule: the main
process owns all data collection, the renderer owns none.

```
src/
  main/        Node context. Discovery, monitoring, alerts, session parsing, SQLite.
  preload/     contextBridge shim. Exposes exactly one object: window.cockpit.
  renderer/    React 19 UI. Two windows: the deck and the menu-bar popover.
  shared/      Types and the i18n dictionary. Imported by both sides.
```

`electron-vite` builds the three separately (`electron.vite.config.ts`); each has
its own tsconfig so a Node API cannot leak into the browser bundle and vice
versa.

---

## The IPC contract

[`src/shared/ipc.ts`](../src/shared/ipc.ts) is the single source of truth for the
process boundary. It declares three things together:

1. `IpcChannels` — every channel name as a const object
2. The payload types for each channel
3. `CockpitApi` — the exact shape of `window.cockpit`

The preload script implements `CockpitApi` and nothing else; the main process
registers handlers for the same channel constants. Adding a feature means editing
one file, and both ends fail to compile until they agree.

The renderer never touches `ipcRenderer` directly, never has `nodeIntegration`,
and runs with `contextIsolation: true`.

```
renderer  ──window.cockpit.scanSessions()──▶  preload  ──invoke("sessions:scan")──▶  main
          ◀────────── SessionScanResult ─────────────────────────────────────────────
```

Monitoring is the one push flow: the renderer subscribes once and main emits a
`monitor:tick` snapshot on its own timer, so the UI stays a pure function of the
last snapshot.

---

## Session parsing: the incremental reader

This is the part with the sharp edges.

Claude Code appends one JSON object per line to
`~/.claude/projects/<slug>/<session-id>.jsonl`. An active session's file grows
without bound and routinely reaches tens of megabytes. Re-reading it every poll
would be unusable, so the parser is incremental.

State per file lives in `ClaudeState` and holds a byte `offset` plus every running
accumulator. On each pass:

1. **Skip entirely if unchanged.** The cache key is `sig = "<mtimeMs>:<size>"`. If
   it matches the last pass, no file handle is opened at all.
2. **Read only the new bytes**, from `offset` to the current size.
3. **Stop at the last newline.** A poll can land mid-write, so the buffer is
   truncated at its final `\n` and the partial trailing line is left for next
   time. `offset` therefore always sits on a line boundary.
4. **Fold each complete line** into the accumulator via `foldClaudeLine`.
5. **Reset on shrink.** If `size < offset`, the file was rotated or truncated, so
   the accumulator is rebuilt from scratch.

Two invariants are load-bearing:

- Because `offset` only ever advances to a newline boundary, slicing the buffer
  can never split a multi-byte UTF-8 character. `0x0a` cannot appear inside a
  UTF-8 sequence, so the boundary is always safe.
- Because the fold is a forward scan, "last write wins" gives the most recent
  value for free (model, cwd, git branch, current task).

Codex uses a different strategy. Its logs put cumulative totals and
`rate_limits` in the *last* record, so there is nothing to accumulate: the parser
reads the trailing 96 KB and scans backwards until it has what it needs.

Concurrent scans are deduplicated. The main-process poller and the renderer's
IPC call both fire every few seconds; `scanSessions()` returns the in-flight
promise rather than doubling the file and `git` IO.

The health scoring itself is pure and lives in
[`main/sessions/health.ts`](../src/main/sessions/health.ts), separated from this
file so it can be unit-tested outside Electron. See
[HEALTH-MODEL.md](./HEALTH-MODEL.md).

---

## Discovery: descriptors, not code

Detection is declarative. [`main/discovery/catalog.ts`](../src/main/discovery/catalog.ts)
holds one `AgentDescriptor` per agent; the engine probes descriptors and knows
nothing about any specific tool. Adding an agent is a data change, not a code
change — see [ADDING-AN-AGENT.md](./ADDING-AN-AGENT.md).

Paths in descriptors use tokens that the engine expands per platform:

| Token | macOS / Linux | Windows |
| --- | --- | --- |
| `~/…` | `$HOME/…` | `%USERPROFILE%\…` |
| `@config/…` | `$XDG_CONFIG_HOME` or `~/.config` | `%APPDATA%` |
| `@appSupport/…` | `~/Library/Application Support` | *(macOS only)* |

Binary resolution walks `PATH` plus the install directories package managers
actually use (`~/.local/bin`, `/opt/homebrew/bin`, `~/.bun/bin`, `~/.cargo/bin`),
because a GUI-launched Electron app inherits a much thinner `PATH` than your
shell. Version strings come from running the binary with its version flag under a
2.5 s timeout, and a failure downgrades to "detected, version unknown" rather
than dropping the agent.

---

## Monitoring: attribution is the hard part

The monitor polls process, CPU, memory and listening-port data via
`systeminformation`, then has to answer "which agent is this process?"

Two problems:

**Interpreters hide identity.** A Claude Code process is `node`, not `claude`.
So a set of known runtimes (`node`, `bun`, `deno`, `python`, `ruby`, `electron`)
is treated as transparent: the real identity is the script path in the command
line, matched against the resolved binary path and per-agent name tokens.

**`ps` reports CPU per core.** A process at "400%" on an 8-core machine is using
half the machine. Aggregates are divided by core count so the number in the UI
means "share of this machine".

Processes are assembled into a tree by PPID so you can kill a root and take its
children with it. Orphan detection flags a listening port whose owning process
matches a dev-server pattern (`vite`, `next`, `uvicorn`, …) but has no live agent
parent, which is the usual residue of an agent that exited badly.

---

## Alerts

[`main/alerts/engine.ts`](../src/main/alerts/engine.ts) is a pure-ish rule pass
over each snapshot, producing `Alert[]`. Alert identity is a deterministic
fingerprint (`ctx:<sessionId>`, `cpu:<pid>`) so the same condition dedupes across
ticks, and a `sinceMap` gives each one a stable first-seen timestamp.

Sustained-CPU alerts require N consecutive ticks above the threshold, so a
compile spike does not page you.

[`notify.ts`](../src/main/alerts/notify.ts) turns alerts into OS notifications
and a dock badge. Two details that matter more than they look:

- **Priming.** On first evaluation, everything currently active is recorded as
  already-known and nothing fires. Otherwise launching the app would dump a
  notification for every pre-existing condition.
- **The awaiting transition.** The single most useful notification is not an
  alert at all: it is a session going `working → awaiting`, meaning the agent
  finished and is waiting on you. Main polls sessions on its own timer, so this
  fires with the window closed and is suppressed when the window is focused.

---

## Storage

`userData/cockpit.db` (SQLite via `better-sqlite3`, WAL mode). Four tables:

| Table | Contents | Retention |
| --- | --- | --- |
| `settings` | JSON key-value, including `appSettings` | forever |
| `history` | totals sample every 30 s, for sparklines across restarts | 24 h |
| `session_ledger` | per-session cost high-water mark | pruned with history |
| `spend_daily` | `(day, agent)` cost and token rollup | forever |

The ledger exists because sessions report *cumulative* totals. Writing deltas
would double-count on every poll, so the ledger keeps the last known total per
session and the daily rollup is derived from the difference.

Native module note: `better-sqlite3` must be unpacked from the asar to load,
hence `asarUnpack` in `electron-builder.yml`, and it is rebuilt against the
Electron ABI at package time.

---

## Account quota: a side channel

Claude Code does not expose rate-limit state on disk. It does pass it to a
`statusLine` hook.

So the cockpit can install a status-line script that reads the hook payload,
writes the `rate_limits` block to `~/.claude/rate-limits.json`, and prints
nothing (so no visible status line appears). The cockpit then reads that file.

The install is deliberately conservative, because it writes into a config file it
does not own:

- Idempotent: rewriting the script is always safe.
- It backs up `settings.json` once before the first modification.
- If you already have your own `statusLine`, it **refuses** to overwrite and
  reports a conflict instead.

Codex needs none of this: it writes `rate_limits` into its own session logs.

---

## i18n

English is the default; the dictionary lives in
[`shared/i18n/`](../src/shared/i18n/) and is imported by **both** processes,
because notifications and menus are emitted from main while the UI comes from the
renderer. A single dictionary keeps them from drifting.

Consequently `Alert` and `AgentSession` carry already-rendered strings across
IPC. The exception is health diagnoses, which travel as *both* a rendered string
and a stable `healthDiagKey`: the UI needs to branch on the diagnosis type, and
branching on translated text is a bug waiting for a locale switch.

`en.ts` defines the key set; other locales are `Record<I18nKey, string>`, so a
missing translation is a compile error. `npm run check:i18n` additionally fails
the build on Chinese text hardcoded outside the dictionary — the English UI would
otherwise silently show Chinese, which no test would catch.
