#!/usr/bin/env node
/**
 * Fails if user-facing Chinese text is hardcoded outside the zh-CN dictionary.
 *
 * English is the default UI language, so a missed string does not crash
 * anything — it silently shows Chinese to every English user. That is the kind
 * of regression a reviewer skims past, so it is enforced mechanically.
 *
 * Written in Node rather than grep on purpose: BSD grep (macOS) has no -P, and
 * a failing grep exits non-zero with empty output, which reads as "clean".
 * Comments may contain Chinese; only code is checked.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname: on Windows the latter yields "/D:/..." and
// join() then produces "D:\\D:\\...".
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");
/** The dictionary itself, plus tests whose assertions are literal translations. */
const ALLOWED = [/^src\/shared\/i18n\/zh-CN\.ts$/, /\.test\.tsx?$/];
/**
 * Escape hatch for Chinese that is NOT UI copy: product names, patterns that
 * match Chinese user input, language names written in their own language.
 * Requires a trailing `// i18n-exempt: <reason>` so the exception is justified
 * in the diff rather than silently whitelisted.
 */
const EXEMPT = /i18n-exempt:/;
const CJK = /[一-鿿]/;

/** Blank out comment bodies so Chinese in prose does not trip the check. */
function stripComments(text) {
  let out = "";
  let inBlock = false;
  let inLine = false;
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      out += c === "\n" ? "\n" : " ";
      continue;
    }
    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += "\n";
      } else out += " ";
      continue;
    }
    if (inStr) {
      if (c === "\\") {
        out += c + (next ?? "");
        i++;
        continue;
      }
      if (c === inStr) inStr = null;
      out += c;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i++;
      continue;
    }
    if (c === "/" && next === "/") {
      inLine = true;
      out += "  ";
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    out += c;
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
  return files;
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split(sep).join("/"); // match ALLOWED on any OS
  if (ALLOWED.some((re) => re.test(rel))) continue;
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  const codeLines = stripComments(raw).split("\n");
  codeLines.forEach((line, i) => {
    if (!CJK.test(line)) return;
    // the marker lives in a comment (stripped above), so consult the original.
    // Accept it on the same line or the one before — long lines get the comment
    // on the preceding line.
    if (EXEMPT.test(rawLines[i] ?? "") || EXEMPT.test(rawLines[i - 1] ?? "")) return;
    offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

if (offenders.length > 0) {
  console.error("✗ hardcoded Chinese found outside src/shared/i18n/zh-CN.ts:\n");
  for (const o of offenders) console.error(`  ${o}`);
  console.error("\nMove these strings into src/shared/i18n/{en,zh-CN}.ts and call t().");
  process.exit(1);
}

console.log("✓ no hardcoded Chinese outside the zh-CN dictionary");
