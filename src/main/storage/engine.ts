import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { StorageItem, StorageScan } from "@shared/storage";

const cache = new Map<string, StorageScan>();
const TTL = 60_000;
const TOP_N = 16;

/** `du -k -d1` → immediate-subdir sizes (KB) + the path total. */
function duChildren(path: string): Promise<{ total: number; dirs: Map<string, number> }> {
  return new Promise((resolve, reject) => {
    execFile(
      "du",
      ["-k", "-d", "1", path],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        const dirs = new Map<string, number>();
        let total = 0;
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          const tab = line.indexOf("\t");
          if (tab < 0) continue;
          const kb = Number(line.slice(0, tab));
          const p = line.slice(tab + 1);
          if (Number.isNaN(kb)) continue;
          if (p === path) total = kb * 1024;
          else {
            const name = p.slice(path.length).replace(/^\/+/, "");
            if (name && !name.includes("/")) dirs.set(name, kb * 1024);
          }
        }
        resolve({ total, dirs });
      }
    );
  });
}

export async function scanStorage(path: string): Promise<StorageScan> {
  const now = Date.now();
  const cached = cache.get(path);
  if (cached && now - cached.scannedAt < TTL) return cached;

  let result: StorageScan;
  try {
    const { total, dirs } = await duChildren(path);
    const items: StorageItem[] = [...dirs.entries()].map(([name, bytes]) => ({
      name,
      bytes,
      kind: "dir" as const
    }));
    // add top-level loose files (du -d1 only lists dirs)
    try {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isFile()) {
          try {
            const st = statSync(join(path, entry.name));
            if (st.size > 0) items.push({ name: entry.name, bytes: st.size, kind: "file" });
          } catch {
            /* skip */
          }
        }
      }
    } catch {
      /* skip */
    }
    items.sort((a, b) => b.bytes - a.bytes);
    result = { path, totalBytes: total, items: items.slice(0, TOP_N), scannedAt: now };
  } catch (e) {
    result = {
      path,
      totalBytes: 0,
      items: [],
      scannedAt: now,
      error: e instanceof Error ? e.message : "scan failed"
    };
  }
  cache.set(path, result);
  return result;
}
