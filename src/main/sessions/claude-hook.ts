import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  copyFileSync,
  statSync
} from "node:fs";
import { t } from "@shared/i18n";
import type { ClaudeHookStatus, ClaudeHookInstallResult } from "@shared/sessions";

/** Claude config dir — respects CLAUDE_CONFIG_DIR like the CLI itself. */
function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

const SCRIPT_NAME = "cockpit-statusline.sh";

function scriptPath(): string {
  return join(configDir(), SCRIPT_NAME);
}

/** The statusline hook body — silently writes rate-limit data, prints nothing. */
function scriptBody(): string {
  return `#!/bin/bash
# Agent Cockpit StatusLine hook — silently writes Claude rate-limit data
# to rate-limits.json for Agent Cockpit to read. Prints nothing, so it does
# not add a visible status line.
INPUT=""
while IFS= read -r -t 5 line || [ -n "$line" ]; do
    INPUT="\${INPUT}\${line}
"
done
[ -z "$INPUT" ] && exit 0
printf '%s' "$INPUT" | python3 -c "
import sys, json, time, os
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
rl = data.get('rate_limits')
if not rl:
    sys.exit(0)
out = {'source': 'claude', 'updated_at': int(time.time())}
fh = rl.get('five_hour')
if fh:
    out['five_hour'] = {'used_percentage': fh.get('used_percentage', 0), 'resets_at': fh.get('resets_at', 0)}
sd = rl.get('seven_day')
if sd:
    out['seven_day'] = {'used_percentage': sd.get('used_percentage', 0), 'resets_at': sd.get('resets_at', 0)}
config_dir = os.environ.get('CLAUDE_CONFIG_DIR', os.path.join(os.path.expanduser('~'), '.claude'))
tmp = os.path.join(config_dir, 'rate-limits.json.tmp')
dst = os.path.join(config_dir, 'rate-limits.json')
with open(tmp, 'w') as f:
    json.dump(out, f)
os.replace(tmp, dst)
" 2>/dev/null
exit 0
`;
}

function readSettings(): { json: Record<string, unknown> | null; raw: string | null } {
  const p = join(configDir(), "settings.json");
  if (!existsSync(p)) return { json: null, raw: null };
  try {
    const raw = readFileSync(p, "utf8");
    return { json: JSON.parse(raw) as Record<string, unknown>, raw };
  } catch {
    return { json: null, raw: null };
  }
}

/** Is the configured statusLine ours, someone else's, or absent? */
function wiredState(json: Record<string, unknown> | null): "ours" | "other" | "none" {
  const sl = json?.["statusLine"] as { command?: string } | undefined;
  if (!sl || typeof sl !== "object") return "none";
  const cmd = typeof sl.command === "string" ? sl.command : "";
  return cmd.includes(SCRIPT_NAME) ? "ours" : "other";
}

const FRESH_MS = 24 * 60 * 60 * 1000;

/** quota data is "flowing" only if rate-limits.json was updated recently —
 * a stale leftover file shouldn't read as "reporting". */
function dataFresh(): boolean {
  const p = join(configDir(), "rate-limits.json");
  if (!existsSync(p)) return false;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { updated_at?: number };
    const updatedMs = typeof j.updated_at === "number" ? j.updated_at * 1000 : statSync(p).mtimeMs;
    return Date.now() - updatedMs < FRESH_MS;
  } catch {
    return false;
  }
}

export function getClaudeHookStatus(): ClaudeHookStatus {
  const { json } = readSettings();
  return {
    scriptExists: existsSync(scriptPath()),
    wired: wiredState(json),
    hasData: dataFresh()
  };
}

/**
 * Install the hook idempotently: always (re)writes the script; wires the
 * statusLine only if absent or already ours. If the user has their OWN
 * statusLine, refuses to clobber it and reports a conflict.
 */
export function installClaudeHook(): ClaudeHookInstallResult {
  const dir = configDir();
  if (!existsSync(dir)) {
    return { ok: false, status: getClaudeHookStatus(), error: t("hook.err.noClaudeDir") };
  }

  try {
    writeFileSync(scriptPath(), scriptBody(), "utf8");
    chmodSync(scriptPath(), 0o755);
  } catch (e) {
    return {
      ok: false,
      status: getClaudeHookStatus(),
      error: e instanceof Error ? e.message : t("hook.err.writeScript")
    };
  }

  const settingsFile = join(dir, "settings.json");
  const { json } = readSettings();
  const state = wiredState(json);

  if (state === "other") {
    // never silently replace the user's own status line
    return { ok: true, status: getClaudeHookStatus(), conflict: true };
  }

  if (state === "none") {
    try {
      if (existsSync(settingsFile)) {
        const bak = `${settingsFile}.cockpit-bak`;
        if (!existsSync(bak)) copyFileSync(settingsFile, bak); // one-time backup
      }
      const next = { ...(json ?? {}) };
      next["statusLine"] = { type: "command", command: scriptPath(), padding: 0 };
      writeFileSync(settingsFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    } catch (e) {
      return {
        ok: false,
        status: getClaudeHookStatus(),
        error: e instanceof Error ? e.message : t("hook.err.writeSettings")
      };
    }
  }

  return { ok: true, status: getClaudeHookStatus() };
}
