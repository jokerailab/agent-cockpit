/** Real-time runtime monitoring — shared shapes (main poller ↔ renderer). */

export interface SeriesPoint {
  cpu: number; // summed % across agent processes
  mem: number; // summed % across agent processes
}

export interface MonitorProcess {
  agentId: string;
  pid: number;
  ppid: number;
  command: string;
  cpu: number; // %
  mem: number; // %
  elapsedSec: number;
  depth: number; // 0 = root
  isRoot: boolean;
}

export interface PortInfo {
  agentId: string;
  pid: number;
  protocol: string;
  localPort: string;
  state: string;
  process: string;
  /** listening dev-server likely left running by the agent */
  orphan: boolean;
}

export interface AgentRuntime {
  agentId: string;
  procCount: number;
  rootCount: number;
  totalCpu: number;
  totalMem: number;
  listenPorts: number;
  longestElapsedSec: number;
  series: SeriesPoint[]; // rolling window, latest last
}

export interface MonitorTotals {
  procs: number;
  cpu: number;
  mem: number;
  listenPorts: number;
  alerts: number;
}

export interface MonitorSnapshot {
  generatedAt: string;
  intervalMs: number;
  running: boolean;
  totals: MonitorTotals;
  agents: AgentRuntime[];
  processes: MonitorProcess[];
  ports: PortInfo[];
  alerts: import("./alerts").Alert[];
}

export type MonitorAction = "killPid" | "killTree";

export interface MonitorActionResult {
  ok: boolean;
  error?: string;
}
