import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import type {
  AgentEvidence,
  DetectedAgent,
  DiscoveryResult
} from "@shared/agents";
import { CATALOG, type AgentDescriptor } from "./catalog";

const HOME = homedir();
const PLATFORM = platform();

function configHome(): string {
  if (PLATFORM === "win32") return process.env["APPDATA"] || join(HOME, "AppData", "Roaming");
  return process.env["XDG_CONFIG_HOME"] || join(HOME, ".config");
}

function appSupport(): string {
  return join(HOME, "Library", "Application Support");
}

/** Expand path tokens (~, @config, @appSupport) to absolute paths. */
function expand(token: string): string {
  if (token.startsWith("~/")) return join(HOME, token.slice(2));
  if (token.startsWith("@config/")) return join(configHome(), token.slice(8));
  if (token.startsWith("@appSupport/")) return join(appSupport(), token.slice(12));
  return token;
}

/** Resolve a binary name across PATH (+ common install dirs). */
function resolveBin(name: string): string | null {
  const exts = PLATFORM === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  const pathDirs = (process.env["PATH"] || "").split(delimiter);
  const extraDirs = [
    join(HOME, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(HOME, ".bun", "bin"),
    join(HOME, ".cargo", "bin")
  ];
  for (const dir of [...pathDirs, ...extraDirs]) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = join(dir, name + ext);
      try {
        if (existsSync(full)) return full;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

function appBundlePath(name: string): string | null {
  const candidates = [
    `/Applications/${name}.app`,
    join(HOME, "Applications", `${name}.app`)
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readVersion(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { timeout: 2500, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) return resolve(null);
      const text = `${stdout || ""}${stderr || ""}`.trim();
      const m = text.match(/\d+\.\d+\.\d+(?:[-.\w]+)?/);
      resolve(m ? m[0] : text.split("\n")[0]?.slice(0, 24) || null);
    });
    child.on("error", () => resolve(null));
  });
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

async function probe(desc: AgentDescriptor): Promise<DetectedAgent | null> {
  const evidence: AgentEvidence[] = [];
  let binPath: string | null = null;
  let homePath: string | null = null;

  for (const b of desc.bins || []) {
    const r = resolveBin(b);
    if (r) {
      binPath = r;
      evidence.push({ type: "binary", detail: r });
      break;
    }
  }
  for (const d of desc.dirs || []) {
    const abs = expand(d);
    if (isDir(abs)) {
      if (!homePath) homePath = abs;
      evidence.push({ type: "home", detail: abs });
    }
  }
  for (const f of desc.files || []) {
    const abs = expand(f);
    if (existsSync(abs)) {
      if (!homePath) homePath = dirname(abs);
      evidence.push({ type: "config", detail: abs });
    }
  }
  if (PLATFORM === "darwin") {
    for (const a of desc.appBundles || []) {
      const ap = appBundlePath(a);
      if (ap) evidence.push({ type: "app", detail: ap });
    }
  }

  if (evidence.length === 0) return null;

  let version: string | null = null;
  if (binPath && desc.versionArgs) {
    version = await readVersion(binPath, desc.versionArgs);
  }

  return {
    id: desc.id,
    name: desc.name,
    vendor: desc.vendor,
    kind: desc.kind,
    accent: desc.accent,
    version,
    binPath,
    homePath,
    evidence,
    confidence: binPath ? "high" : "medium"
  };
}

let lastDiscovery: DiscoveryResult | null = null;
let inFlight: Promise<DiscoveryResult> | null = null;

export function getLastDiscovery(): DiscoveryResult | null {
  return lastDiscovery;
}

/** Cold-scan the machine against the full descriptor catalog.
 * Dedupes concurrent calls (monitor's first tick + renderer's mount both kick
 * one off at startup) so we don't spawn the whole --version probe set twice. */
export async function scanAgents(): Promise<DiscoveryResult> {
  if (inFlight) return inFlight;
  inFlight = doScan().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doScan(): Promise<DiscoveryResult> {
  const results = await Promise.all(CATALOG.map((d) => probe(d)));
  const agents = results.filter((a): a is DetectedAgent => a !== null);
  // stable order: high-confidence first, then by name
  agents.sort((a, b) => {
    if (a.confidence !== b.confidence) return a.confidence === "high" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  lastDiscovery = {
    generatedAt: new Date().toISOString(),
    platform: PLATFORM,
    scanned: CATALOG.length,
    agents
  };
  return lastDiscovery;
}
