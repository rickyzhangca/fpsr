#!/usr/bin/env node
/**
 * Soft warning for oversized production modules (>600 LOC).
 * Does not fail CI — surfaces modules that may need a domain split.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps", "packages", "tools"];
const DIR_NAMES = new Set(["src", "scripts"]);
const EXTS = new Set([".ts", ".tsx"]);
const MAX_LINES = 600;

/** Paths (relative to repo root) excluded from the soft check. */
const EXCLUDE_SUFFIXES = [".test.ts", ".test.tsx", ".snap.txt", ".d.ts"];

const EXCLUDE_BASENAMES = new Set(["render-db.ts", "vite-env.d.ts"]);

const EXCLUDE_DIRS = new Set(["fixtures", "node_modules", "dist"]);

function shouldSkip(relPath) {
  if (EXCLUDE_BASENAMES.has(path.basename(relPath))) return true;
  if (EXCLUDE_SUFFIXES.some((suffix) => relPath.endsWith(suffix))) return true;
  const parts = relPath.split(path.sep);
  if (parts.some((part) => EXCLUDE_DIRS.has(part))) return true;
  return false;
}

function* walkDirs(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const full = path.join(dir, ent.name);
    if (!ent.isDirectory()) continue;
    if (DIR_NAMES.has(ent.name)) yield full;
    else yield* walkDirs(full);
  }
}

function* walkFiles(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkFiles(full);
    else if (EXTS.has(path.extname(ent.name))) yield full;
  }
}

const oversized = [];
for (const group of ROOTS) {
  const groupDir = path.join(root, group);
  if (!fs.existsSync(groupDir)) continue;
  for (const srcDir of walkDirs(groupDir)) {
    for (const file of walkFiles(srcDir)) {
      const rel = path.relative(root, file);
      if (shouldSkip(rel)) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n").length;
      if (lines > MAX_LINES) oversized.push({ rel, lines });
    }
  }
}

if (oversized.length === 0) {
  console.log(`No production modules exceed ${MAX_LINES} lines.`);
  process.exit(0);
}

oversized.sort((a, b) => b.lines - a.lines);
console.warn(`Warning: ${oversized.length} production module(s) exceed ${MAX_LINES} lines:\n`);
for (const { rel, lines } of oversized) {
  console.warn(`  ${rel} (${lines} lines)`);
}
console.warn("\nConsider splitting modules with multiple concerns. This check is advisory only.");
