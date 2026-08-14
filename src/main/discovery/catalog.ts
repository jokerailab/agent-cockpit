import type { AgentKind } from "@shared/agents";

/**
 * Agent descriptor — declarative detection rules.
 * Add a new agent = add one entry here. Engine probes these against the machine.
 *
 * Path tokens (expanded by the engine per-platform):
 *   ~/...            → user home
 *   @config/...      → XDG_CONFIG_HOME or ~/.config (mac/linux), %APPDATA% (win)
 *   @appSupport/...  → ~/Library/Application Support (mac only)
 * appBundles are matched in /Applications and ~/Applications (mac).
 */
export interface AgentDescriptor {
  id: string;
  name: string;
  vendor: string;
  kind: AgentKind;
  accent: string;
  /** PATH binary names to resolve */
  bins?: string[];
  /** directories whose existence implies install */
  dirs?: string[];
  /** files whose existence implies install */
  files?: string[];
  /** macOS .app bundle names (without .app) */
  appBundles?: string[];
  /** command (uses resolved bin) to read version, e.g. "--version" */
  versionArgs?: string[];
}

export const CATALOG: AgentDescriptor[] = [
  // ── frontier CLI / desktop agents ──────────────────────────────
  {
    id: "claude",
    name: "Claude Code",
    vendor: "Anthropic",
    kind: "cli",
    accent: "--agent-claude",
    bins: ["claude"],
    dirs: ["~/.claude"],
    files: ["~/.claude/settings.json"],
    versionArgs: ["--version"]
  },
  {
    id: "codex",
    name: "Codex",
    vendor: "OpenAI",
    kind: "cli",
    accent: "--agent-codex",
    bins: ["codex"],
    dirs: ["~/.codex"],
    files: ["~/.codex/config.toml"],
    appBundles: ["Codex"],
    versionArgs: ["--version"]
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    vendor: "Google",
    kind: "cli",
    accent: "--agent-gemini",
    bins: ["gemini"],
    dirs: ["~/.gemini"],
    files: ["~/.gemini/settings.json"],
    versionArgs: ["--version"]
  },
  {
    id: "antigravity",
    name: "Antigravity",
    vendor: "Google",
    kind: "ide",
    accent: "--agent-antigravity",
    bins: ["antigravity"],
    dirs: ["~/.antigravity", "@appSupport/Antigravity"],
    appBundles: ["Antigravity"]
  },
  {
    id: "cursor",
    name: "Cursor",
    vendor: "Anysphere",
    kind: "ide",
    accent: "--agent-unknown",
    bins: ["cursor-agent", "cursor"],
    dirs: ["~/.cursor", "@appSupport/Cursor"],
    appBundles: ["Cursor"]
  },
  {
    id: "windsurf",
    name: "Windsurf",
    vendor: "Codeium",
    kind: "ide",
    accent: "--agent-gemini",
    bins: ["windsurf"],
    dirs: ["~/.codeium", "~/.windsurf", "@appSupport/Windsurf"],
    appBundles: ["Windsurf"]
  },

  // ── open-source CLI coding agents ──────────────────────────────
  {
    id: "opencode",
    name: "opencode",
    vendor: "SST",
    kind: "cli",
    accent: "--agent-codex",
    bins: ["opencode"],
    dirs: ["@config/opencode"],
    files: ["@config/opencode/opencode.json"],
    versionArgs: ["--version"]
  },
  {
    id: "aider",
    name: "Aider",
    vendor: "Aider AI",
    kind: "cli",
    accent: "--agent-claude",
    bins: ["aider"],
    dirs: ["~/.aider"],
    files: ["~/.aider.conf.yml"],
    versionArgs: ["--version"]
  },
  {
    id: "goose",
    name: "Goose",
    vendor: "Block",
    kind: "cli",
    accent: "--agent-antigravity",
    bins: ["goose"],
    files: ["@config/goose/config.yaml"],
    versionArgs: ["--version"]
  },
  {
    id: "amp",
    name: "Amp",
    vendor: "Sourcegraph",
    kind: "cli",
    accent: "--agent-codex",
    bins: ["amp"],
    versionArgs: ["--version"]
  },
  {
    id: "cline",
    name: "Cline",
    vendor: "Cline",
    kind: "ide-ext",
    accent: "--agent-gemini",
    bins: ["cline"],
    dirs: ["~/.cline"]
  },
  {
    id: "continue",
    name: "Continue",
    vendor: "Continue.dev",
    kind: "ide-ext",
    accent: "--agent-codex",
    dirs: ["~/.continue"]
  },

  // ── Chinese coding agents ──────────────────────────────────────
  {
    id: "qwen",
    name: "Qwen Code",
    vendor: "Alibaba",
    kind: "cli",
    accent: "--agent-antigravity",
    bins: ["qwen", "qwen-code"],
    dirs: ["~/.qwen"],
    versionArgs: ["--version"]
  },
  {
    id: "lingma",
    name: "通义灵码 Lingma", // i18n-exempt: product name, not translated
    vendor: "Alibaba",
    kind: "ide-ext",
    accent: "--agent-antigravity",
    bins: ["lingma"],
    dirs: ["~/.lingma"]
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    vendor: "Tencent",
    kind: "cli",
    accent: "--agent-gemini",
    bins: ["codebuddy"],
    dirs: ["~/.codebuddy", "@appSupport/CodeBuddy"],
    appBundles: ["CodeBuddy"],
    versionArgs: ["--version"]
  },
  {
    id: "trae",
    name: "Trae",
    vendor: "ByteDance",
    kind: "ide",
    accent: "--agent-unknown",
    dirs: ["~/.trae", "@appSupport/Trae"],
    appBundles: ["Trae", "Trae CN"]
  },
  {
    id: "codegeex",
    name: "CodeGeeX",
    vendor: "Zhipu AI",
    kind: "ide-ext",
    accent: "--agent-codex",
    dirs: ["~/.codegeex"]
  }
];
