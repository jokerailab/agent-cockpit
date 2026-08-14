# Adding an agent

Detection is data, not code. Supporting a new agent is one entry in one array,
and the fastest PRs to review are the ones that only touch that array.

Currently detected: Claude Code, Codex, Gemini CLI, Antigravity, Cursor,
Windsurf, opencode, Aider, Goose, Amp, Cline, Continue, Qwen Code, 通义灵码
Lingma, CodeBuddy, Trae, CodeGeeX.

---

## 1. Add a descriptor

Append to `CATALOG` in [`src/main/discovery/catalog.ts`](../src/main/discovery/catalog.ts):

```ts
{
  id: "mytool",              // stable slug; also the default process-name token
  name: "My Tool",           // shown in the UI
  vendor: "Acme",
  kind: "cli",               // cli | ide | ide-ext | framework
  accent: "--agent-codex",   // a CSS custom property from styles/tokens.css
  bins: ["mytool"],          // binaries to resolve on PATH
  dirs: ["~/.mytool"],       // directories whose existence implies an install
  files: ["~/.mytool/config.json"],
  appBundles: ["My Tool"],   // macOS .app names, without ".app"
  versionArgs: ["--version"] // omit if the binary has no version flag
}
```

Every field except `id`, `name`, `vendor`, `kind` and `accent` is optional. Give
it whatever evidence exists; the engine reports an agent as detected if **any**
probe hits, and shows which evidence matched.

### Path tokens

Do not hardcode absolute paths. The engine expands these per platform:

| Token | macOS / Linux | Windows |
| --- | --- | --- |
| `~/…` | `$HOME/…` | `%USERPROFILE%\…` |
| `@config/…` | `$XDG_CONFIG_HOME` or `~/.config` | `%APPDATA%` |
| `@appSupport/…` | `~/Library/Application Support` | *(macOS only, skipped elsewhere)* |

`appBundles` entries are looked up in `/Applications` and `~/Applications`, and
are ignored on non-macOS platforms.

### Choosing an accent

Accents are CSS custom properties defined in
[`styles/tokens.css`](../src/renderer/src/styles/tokens.css). Reuse an existing
one (`--agent-claude`, `--agent-codex`, `--agent-gemini`, `--agent-antigravity`,
`--agent-unknown`) unless the agent is prominent enough to deserve its own, in
which case add the property in the same PR.

---

## 2. Add process-name tokens (if needed)

The monitor needs to recognise the agent's processes. By default it matches the
descriptor `id`. If the running process is named differently, add tokens to
`PROC_TOKENS` in [`src/main/monitor/engine.ts`](../src/main/monitor/engine.ts):

```ts
const PROC_TOKENS: Record<string, string[]> = {
  // …
  mytool: ["mytool", "mytool-server"]
};
```

This matters for anything launched through an interpreter. A tool that runs as
`node /path/to/mytool/cli.js` is reported by the OS as `node`, so the engine looks
past known runtimes (`node`, `bun`, `deno`, `python`, `ruby`, `electron`) and
matches these tokens against the script path instead.

---

## 3. Verify locally

```bash
npm run dev
```

Then check, in order:

1. The agent appears under **Detected Agents**. If not, its probes did not match:
   confirm the paths exist on your machine and that the binary is resolvable
   (remember a GUI-launched app has a thinner `PATH` than your shell).
2. The version renders. A missing version is acceptable and shows as detected
   without one; a *wrong* version usually means `versionArgs` prints something the
   regex cannot parse.
3. Start the agent, and confirm its processes attach to its card rather than
   landing under a generic entry. If they do not, revisit step 2.

Finally:

```bash
npm run verify   # typecheck + i18n guard + tests
```

---

## Session introspection is a separate, larger job

A descriptor gets you detection, process attribution, CPU/memory/port monitoring
and resource alerts. It does **not** get you context percentage, token counts,
cost, or a health score. Those require parsing that agent's session logs, and
every agent writes a different format.

Today only Claude Code and Codex are parsed, and only Claude Code is health-scored
(see [HEALTH-MODEL.md](./HEALTH-MODEL.md#known-limits-and-false-positives) for
why). The UI states this honestly per agent rather than showing zeros: agents
without a parser display "process-level monitoring only".

If you want to add a parser, `main/sessions/engine.ts` is the place, and the
existing Claude (incremental, cumulative) and Codex (tail-read) implementations
are the two shapes to copy from. Please open an issue first so we can agree on
where it hooks in.

---

## What gets a PR merged quickly

- One agent per PR.
- Say which OS and version you verified on. "Detected on macOS 15, Cursor 0.44"
  is enough.
- A screenshot of the card is welcome but not required. If you include one, use
  the mock harness in [`docs/mock/`](./mock/) rather than a real screenshot, so
  your project names stay private.
- If the agent is only installable on a platform you do not have, say so. Partial
  descriptors are fine and better than none.
