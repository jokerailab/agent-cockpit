/**
 * English dictionary — the source of truth for the key set.
 *
 * Every other locale is typed as `Record<I18nKey, string>`, so adding a key
 * here and forgetting to translate it fails `npm run typecheck`.
 * Placeholders use `{name}` and are substituted by `t()`.
 */
export const en = {
  /* ── generic ─────────────────────────────────────────────── */
  "common.dash": "—",
  "common.confirm": "Confirm?",
  "common.clear": "Clear",
  "common.unset": "Not set",
  "common.scanning": "Scanning…",
  "common.turns": "{n} turns",
  "common.sessions": "sessions",
  "common.session": "session",

  /* ── time ────────────────────────────────────────────────── */
  "time.ago": "{v} ago",
  "time.justNow": "just now",
  "time.minutes": "{m}m",
  "time.hoursMinutes": "{h}h{m}m",
  "time.resetting": "resetting",

  /* ── turn-level activity ─────────────────────────────────── */
  "activity.working": "Working",
  "activity.awaiting": "Awaiting you",
  "activity.idle": "Idle",

  /* ── agent kinds ─────────────────────────────────────────── */
  "agent.kind.cli": "CLI",
  "agent.kind.ide": "IDE",
  "agent.kind.ide-ext": "Extension",
  "agent.kind.framework": "Framework",

  /* ── health diagnoses (see docs/HEALTH-MODEL.md) ─────────── */
  "health.diag.contextBlown": "Context window exhausted",
  "health.diag.contextTight": "Context window tight",
  "health.diag.spinningBad": "Spinning badly (most replies produce no output)",
  "health.diag.spinning": "Spinning (some replies produce no output)",
  "health.diag.degenerate": "Repetition loop (same token ×{run})",
  "health.diag.stalled": "Repeatedly nudged to continue (stuck ×{count})",
  "health.diag.errorProne": "Frequent tool errors ({pct}%)",
  "health.diag.churning": "Repeated compaction ({count}×, context thrashing)",
  "health.diag.bloated": "Oversized session file",
  "health.diag.tooManyTurns": "Excessive turn count",
  "health.diag.healthy": "Healthy",
  "health.diag.lowScore": "Health score too low",

  /* ── health advice ───────────────────────────────────────── */
  "health.advice.unsalvageable":
    "Beyond saving · hand over to a fresh session with the original task and files; archive this one",
  "health.advice.contextBlown":
    "Context full · start fresh and carry over the task plus key files",
  "health.advice.contextTight": "Context tight · try /compact, then hand over if that is not enough",
  "health.advice.stalled": "Looks stuck · interrupt, then hand over to a fresh session",
  "health.advice.errorProne": "Frequent errors · check environment and permissions first",
  "health.advice.failing": "Unhealthy · hand over and archive this session",
  "health.advice.degrading": "Borderline · watch it; /compact or hand over if it worsens",

  /* ── session audit panel ─────────────────────────────────── */
  "audit.title": "Session Audit",
  "audit.lead":
    "Health of Claude sessions from the last 45 days (up to 150, newest first), worst first",
  "audit.leadCount": " · scanned {total}, {bad} need attention",
  "audit.onlyBad": "Only show what needs attention",
  "audit.scanning": "Scanning… (the first run is slower)",
  "audit.empty": "Nothing needs attention 🎉",
  "audit.live": "Live",
  "audit.advice": "Advice · {text}",

  /* ── session card ────────────────────────────────────────── */
  "session.healthTitle": "Session health",
  "session.degraded": "Session degraded",
  "session.borderline": "Borderline",
  "session.actionRestart": "Restart advised",
  "session.actionWatch": "Watch",
  "session.compactionNear": "Compaction near",
  "session.burnTitle": "Equivalent API burn rate (estimated)",
  "session.costTitle": "Equivalent API cost (estimated at published rates)",
  "session.projectSize": "Project {size}",
  "session.projectSizeIdle": "Project size",
  "session.diskEmpty": "Directory is empty or unreadable",
  "session.diskError": "Scan failed: {error}",
  "session.noneActive": "Background processes only · no active session",
  "session.noIntrospection": "Process-level monitoring only · no session introspection",
  "session.awaitingCount": "{n} awaiting you",
  "session.awaitingTitle": "{n} conversations are waiting on you",

  /* ── cost framing ────────────────────────────────────────── */
  "cost.actual": "actual spend",
  "cost.equivalent": "equivalent value",
  "cost.estimated": "estimated",
  "cost.planLine": "Plan {plan}/mo · marginal ≈0",
  "cost.planIncluded": "Included in plan",
  "cost.atPublishedRates": "at published rates",

  /* ── spend strip ─────────────────────────────────────────── */
  "spend.today": "Today",
  "spend.week": "This week",
  "spend.month": "This month",
  "spend.payback": "{name} payback",
  "spend.paybackTitle": "Equivalent {spent} this month / plan {plan}",
  "spend.note": "Equivalent API · estimated at published rates",

  /* ── instrument cluster ──────────────────────────────────── */
  "stat.procs": "Active processes",
  "stat.cpu": "CPU",
  "stat.mem": "Memory",
  "stat.ports": "Listening ports",
  "stat.alerts": "Open alerts",
  "cluster.note": "Live totals",

  /* ── alerts ──────────────────────────────────────────────── */
  "alert.cat.context": "Context",
  "alert.cat.quota": "Quota",
  "alert.cat.resource": "Resource",
  "alert.cat.port": "Port",
  "alert.cat.security": "Security",
  "alert.cat.burn": "Burn",
  "alert.cat.health": "Session health",
  "alert.note": "{open} open / {total} total",

  "alert.context.title": "Context {pct}%",
  "alert.context.detail": "{project} · auto-compaction imminent, save your context",
  "alert.burn.title": "Burning ≈${rate}/min",
  "alert.burn.detail": "{project} · equivalent API rate is high (≈${total} so far)",
  "alert.health.title": "Session degraded {score}",
  "alert.health.detail": "{project} · {diag} — start a fresh session",
  "alert.quota.title": "{source} {window} quota {pct}%",
  "alert.quota.detail": "Rate limiting is imminent",
  "alert.cpu.title": "Process CPU {pct}%",
  "alert.cpu.detail": "pid {pid} {command} sustained high usage",
  "alert.mem.title": "Process memory {pct}%",
  "alert.mem.detail": "pid {pid} {command}",
  "alert.orphan.title": "Orphan port :{port}",
  "alert.orphan.detail": "{process} (pid {pid}) looks like a leftover service",
  "alert.sec.claudeBash.title": "Claude broad permission",
  "alert.sec.claudeBash.detail":
    "permissions.allow contains \"{rule}\" — Bash is fully allowed, review this",
  "alert.sec.geminiTrust.title": "Gemini has many trusted folders",
  "alert.sec.geminiTrust.detail": "{count} trusted folders",

  /* ── OS notifications ────────────────────────────────────── */
  "notify.awaiting.title": "✋ Awaiting you · {project}",
  "notify.awaiting.body": "{agent} finished this turn: {task}",
  "notify.awaiting.bodyNoTask": "{agent} finished this turn and is waiting on you",

  /* ── app + tray menu ─────────────────────────────────────── */
  "menu.settings": "Settings…",
  "menu.quit": "Quit Agent Cockpit",
  "menu.actions": "Actions",
  "menu.rescan": "Rescan agents",
  "menu.toggleMonitor": "Pause/resume monitoring",
  "menu.edit": "Edit",
  "menu.view": "View",
  "tray.open": "Open Cockpit",
  "tray.rescan": "Rescan",
  "tray.quit": "Quit",
  "tray.tooltip": "Agent Cockpit · {procs} processes · {cpu}% CPU · {alerts} alerts",

  /* ── settings ────────────────────────────────────────────── */
  "settings.title": "Settings",
  "settings.sec.collection": "Collection",
  "settings.sec.desktop": "Desktop",
  "settings.sec.notifications": "Notifications",
  "settings.sec.billing": "Billing",
  "settings.sec.integrations": "Integrations",
  "settings.sec.thresholds": "Alert thresholds",
  "settings.language": "Language",
  "settings.language.auto": "Auto (system)",
  "settings.pollInterval": "Poll interval",
  "settings.autoLaunch": "Launch at login",
  "settings.globalShortcut": "Global shortcut",
  "settings.shortcutPlaceholder": "Click, then press a key combination",
  "settings.notifyEnabled": "System notifications",
  "settings.notifyLevel": "Notification level",
  "settings.notifyLevel.warn": "Warning and above",
  "settings.notifyLevel.critical": "Critical only",
  "settings.notifyAwaiting": "Notify when an agent is waiting on you",
  "settings.contextWarn": "Context warning",
  "settings.quotaWarn": "Quota warning",
  "settings.cpuWarn": "Process CPU warning",
  "settings.memWarn": "Process memory warning",
  "settings.burnWarn": "Burn rate warning",

  /* ── billing modes ───────────────────────────────────────── */
  "billing.unknown": "Estimate",
  "billing.api": "API pay-per-use",
  "billing.subscription": "Subscription plan",
  "billing.planPlaceholder": "$/mo",

  /* ── Claude quota hook ───────────────────────────────────── */
  "hook.label": "Claude quota monitoring",
  "hook.state.loading": "Checking…",
  "hook.state.ok": "Connected · reporting quota",
  "hook.state.wired": "Connected · waiting for Claude to refresh",
  "hook.state.conflict": "You already have a custom status line",
  "hook.state.none": "Not connected",
  "hook.action.install": "Connect",
  "hook.action.rewrite": "Rewrite script",
  "hook.msg.installed": "Connected. Quota reporting starts after Claude next refreshes.",
  "hook.msg.conflict":
    "You already have a custom statusLine. The script was written but your config was left untouched — wire it up manually.",
  "hook.err.generic": "Install failed",
  "hook.err.noClaudeDir": "~/.claude does not exist; Claude was not detected",
  "hook.err.writeScript": "Failed to write the script",
  "hook.err.writeSettings": "Failed to write settings.json",

  /* ── main deck ───────────────────────────────────────────── */
  "deck.subtitle": "Local agent telemetry deck",
  "deck.telemetry.awaiting": "Awaiting",
  "deck.audit": "Session audit",
  "deck.settings": "Settings",
  "deck.fleet.note": "{found} found / {scanned} probed",
  "deck.fleet.scanning": "Scanning this machine…",
  "deck.fleet.empty": "No installed agents found",
  "deck.rescan": "Rescan",
  "deck.rescanning": "Scanning",
  "deck.idle": "Idle",
  "deck.runtime.note": "{procs} processes · every {interval}s",
  "deck.runtime.connecting": "Connecting…",
  "deck.pause": "⏸ Pause",
  "deck.resume": "▶ Resume",
  "deck.empty.title": "No agent running",
  "deck.empty.body":
    "No active process from a recognised agent. Start one and its process tree and resource trends will appear here live.",
  "deck.connecting.title": "Connecting to live monitoring…",
  "deck.idleAgents": "Idle {names}",
  "deck.orphanTitle": "Kill every leftover dev-server process tree",
  "deck.orphanClean": "Clean orphan dev servers ({n})",
  "deck.orphanConfirm": "Confirm cleaning {n}?",
  "deck.orphanPortTitle": "{process} · possibly a leftover dev server",
  "deck.procFilter": "Filter pid / command / agent",
  "deck.quotaSetup": "Quota not configured · enable",
  "deck.killTree": "kill tree",
  "deck.kill": "kill",

  /* ── menu-bar popover ────────────────────────────────────── */
  "pop.openMain": "Open main window ↗",
  "pop.procs": "processes",
  "pop.cpu": "% CPU",
  "pop.mem": "% memory",
  "pop.ports": "ports",
  "pop.alerts": "alerts",
  "pop.working": "{n} working",
  "pop.awaiting": "{n} awaiting",
  "pop.todaySpend": "Today ≈{amount}",
  "pop.todaySpendTitle": "Equivalent API spend today (estimated)",
  "pop.awaitingSection": "Awaiting you · {n}",
  "pop.longestWait": "longest {wait}",
  "pop.activeAgents": "Active agents",
  "pop.noAgents": "No active agents",
  "pop.alertsSection": "Alerts {n}",
  "pop.sessionsSuffix": "sessions",
  "pop.cleanOrphans": "Clean orphan dev servers ({n})",
  "pop.cleanOrphansConfirm": "Confirm cleaning {n}?"
} as const;

/** The full key set. Declared here (not in index.ts) so locale files can import
 * it without creating a cycle through the module that imports them. */
export type I18nKey = keyof typeof en;
