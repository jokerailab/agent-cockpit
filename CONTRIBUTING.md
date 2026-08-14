# Contributing

Thanks for looking. The most useful contributions, roughly in order:

1. **Support for another agent.** One entry in one array. See
   [docs/ADDING-AN-AGENT.md](docs/ADDING-AN-AGENT.md).
2. **Windows or Linux verification.** Both build in CI; neither has been run by
   the author. An issue saying "detection works, monitoring doesn't" is genuinely
   valuable.
3. **Health model corrections.** If a rule misfires on your workload, say what
   the session was doing. See [docs/HEALTH-MODEL.md](docs/HEALTH-MODEL.md).
4. **A session parser for another agent.** Larger; open an issue first.

## Setup

```bash
npm install
npm run rebuild    # required: rebuilds better-sqlite3 for the Electron ABI
npm run dev
```

Node 20+. On Linux you may need `build-essential` and `python3` for the native
module.

Don't skip `npm run rebuild`. npm installs a `better-sqlite3` prebuilt for your
Node runtime, not for Electron's ABI, and on Apple Silicon it sometimes fetches an
x86_64 binary outright. The symptom is an app that starts fine and then fails
every database call. Re-run it whenever the lockfile changes.

## The gate

```bash
npm run verify
```

This is exactly what CI runs:

- `typecheck` — both projects (main/preload and renderer)
- `check:i18n` — no hardcoded Chinese outside the dictionary
- `test` — vitest

All three must pass. If `check:i18n` flags a string that genuinely isn't UI copy
(a product name, a pattern matching Chinese user input), add a
`// i18n-exempt: <reason>` comment on that line or the one above it. The reason is
required so the exception is reviewable.

## Conventions

**Comments explain why, not what.** The codebase is fairly heavily commented, but
only where the reason isn't obvious from the code. If a line looks removable and
isn't, say so on the line: there are several comments of the form "removing this
regresses X, verified <date>", and they have earned their place.

**No new runtime dependencies without discussion.** There are currently two.
"Makes no network requests" is a documented property of this app, so anything
that could phone home is a hard no.

**UI strings go through `t()`.** English in `src/shared/i18n/en.ts` is the source
of truth for the key set; `zh-CN.ts` is typed against it, so a missing translation
is a compile error, not a runtime blank. If you don't write Chinese, put the
English string in both files and say so in the PR — someone will fix the
translation.

**Branch on keys, not on rendered text.** Health diagnoses cross IPC as both a
translated string and a stable `healthDiagKey`. UI logic must switch on the key.
Matching substrings of the translated text was a real bug, which is why the key
exists.

**Pure logic goes in a testable module.** Anything that imports `electron` can't
be unit-tested, so scoring, pricing and formatting live in files that don't. If
you add a rule to the health model, add test cases for both the penalty value and
whether the rule can become the headline diagnosis.

## Pull requests

- One thing per PR.
- Say what you verified and on what OS/version.
- Screenshots: use the mock harness in [docs/mock/](docs/mock/), never a capture
  of your real sessions. It renders the real stylesheets with fake project names.
- If you touch a user-facing string that appears in a screenshot, update the mock.

## Reporting a bug

Include your OS and version, the app version, which agents are installed, and
what you expected. If it involves session parsing, **do not paste your session
log** — it contains your conversations. The health score, diagnosis and turn count
shown in the UI are usually enough.

If you find the app sending data over the network or writing outside the three
locations listed in [PRIVACY.md](PRIVACY.md), that's a serious bug. Please report
it.
