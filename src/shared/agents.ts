/** Agent discovery — shared shapes between main (engine) and renderer (UI). */

export type AgentKind = "cli" | "ide" | "ide-ext" | "framework";

/** A single piece of evidence that an agent is present on the machine. */
export interface AgentEvidence {
  type: "binary" | "home" | "config" | "app";
  detail: string; // resolved path or app name
}

/** One discovered agent installed on the local machine. */
export interface DetectedAgent {
  id: string;
  name: string;
  vendor: string;
  kind: AgentKind;
  accent: string; // css color token name, e.g. "--agent-codex"
  version: string | null;
  binPath: string | null;
  homePath: string | null;
  evidence: AgentEvidence[];
  /** detection confidence: binary+version = high, dir/config only = medium */
  confidence: "high" | "medium";
}

export interface DiscoveryResult {
  generatedAt: string;
  platform: NodeJS.Platform;
  /** total descriptors probed */
  scanned: number;
  /** installed agents only */
  agents: DetectedAgent[];
}
