/** On-demand project directory storage scan (size + breakdown). */

export interface StorageItem {
  name: string;
  bytes: number;
  kind: "dir" | "file";
}

export interface StorageScan {
  path: string;
  totalBytes: number;
  items: StorageItem[]; // largest children first
  scannedAt: number;
  error?: string;
}
