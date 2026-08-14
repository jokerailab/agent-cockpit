# Privacy

Agent Cockpit reads your agent session logs. Those logs contain your
conversations, your file paths and your project names. You should not take a
claim about that on trust, so this document states exactly what happens and how
to check it yourself.

## Nothing leaves your machine

There is no telemetry, no analytics, no crash reporting, no update check, and no
account. The app makes **no outbound network requests of any kind**.

Verify it:

```bash
grep -rnE "fetch\(|axios|https?://|net\.request|WebSocket|XMLHttpRequest" src/
```

The only match is an `xmlns="http://www.w3.org/2000/svg"` attribute in a CSS
background image, which is an XML namespace identifier, not a URL that is ever
fetched. There is no HTTP client in `package.json`: the only runtime dependencies
are `better-sqlite3` (local database) and `systeminformation` (reads local OS
counters).

You can confirm the built app behaves the same way with Little Snitch, `lsof -i`,
or by running it with networking disabled.

## What it reads

| Path | Why |
| --- | --- |
| `~/.claude/projects/**/*.jsonl` | Session parsing: context, tokens, cost, health signals |
| `~/.codex/sessions/**/*.jsonl` | Same, for Codex, plus rate-limit windows |
| `~/.claude/rate-limits.json` | Account quota, if you installed the status-line hook |
| `~/.claude/settings.json` | Detection, and one security check (is `Bash` fully allowed) |
| `~/.gemini/trustedFolders.json` | One security check (how many folders are trusted) |
| Agent config dirs (`~/.cursor`, `~/.aider`, `@config/opencode`, …) | Detecting which agents are installed |
| `/Applications`, `~/Applications` | Detecting installed desktop agents (macOS) |
| Process list, listening ports | Live monitoring |

It also runs three external commands, all locally:

- `git -C <cwd> status --porcelain` in each session's working directory, to show
  the uncommitted-file count. Read-only; it never runs any other `git` subcommand.
- `du -k -d1 <path>` when you explicitly click "project size" on a session card.
- The agent's own version flag (e.g. `claude --version`) during discovery.

**Conversation content is parsed in memory only.** The most recent user message is
truncated to 120 characters for display as the session's current task, and
assistant text is scanned for token repetition to compute the health score.
Neither is written to disk, logged, or transmitted. The database stores only
numbers: token counts, costs, scores, timestamps, agent ids.

## What it writes

Three locations, and that is the complete list:

**1. Its own database.** `<userData>/cockpit.db`, where `<userData>` is:

- macOS: `~/Library/Application Support/Agent Cockpit/`
- Linux: `~/.config/Agent Cockpit/`
- Windows: `%APPDATA%\Agent Cockpit\`

Contents: settings, a 24-hour rolling window of resource totals, and per-session
and per-day cost rollups. No conversation text.

**2. `~/.claude/cockpit-statusline.sh`** — only if you click "Connect" on the
Claude quota integration. Claude Code does not write rate-limit state to disk, but
it does pass it to a status-line hook, so this script captures that payload into
`~/.claude/rate-limits.json`. It prints nothing, so no status line appears in
Claude. You can read the script's full body in
[`src/main/sessions/claude-hook.ts`](src/main/sessions/claude-hook.ts) before
installing it.

**3. `~/.claude/settings.json`** — same opt-in, to point `statusLine` at that
script. Safeguards:

- It copies `settings.json` to `settings.json.cockpit-bak` once, before the first
  modification.
- If you already have your own `statusLine`, it **refuses to overwrite it** and
  reports a conflict instead. You keep your config; wiring is left to you.
- It changes only the `statusLine` key.

Nothing else in your home directory is ever modified. The app does not delete
files. The one destructive action it can take is sending a signal to a process,
and only when you click "kill" and then confirm.

## Removing everything

```bash
# 1. the app's own data
rm -rf ~/Library/Application\ Support/Agent\ Cockpit          # macOS

# 2. the quota hook, if you installed it
rm -f ~/.claude/cockpit-statusline.sh ~/.claude/rate-limits.json
#    then remove the "statusLine" key from ~/.claude/settings.json,
#    or restore the backup:
mv ~/.claude/settings.json.cockpit-bak ~/.claude/settings.json
```

Then drag the app to the trash.

## Screenshots in this repository

Every screenshot in the README is rendered from static HTML with fabricated
project names, using the app's real stylesheet. No screenshot contains a real
session, path or project. The harness is in [`docs/mock/`](docs/mock/) so
contributors can regenerate them the same way.

## Reporting a problem

If you find a case where the app sends data anywhere, or writes outside the three
locations above, that is a bug and a serious one. Please open an issue.
