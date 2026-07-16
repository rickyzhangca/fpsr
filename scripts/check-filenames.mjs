#!/usr/bin/env node
/**
 * Enforce kebab-case source filenames across the monorepo.
 * Allowed: hello-world.ts, foo.test.ts, bar.worker.ts, vite-env.d.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["apps", "packages", "tools"];
const DIR_NAMES = new Set(["src", "scripts"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const VALID = /^[a-z0-9]+(-[a-z0-9]+)*(\.(test|worker|d))?\.(ts|tsx|js|mjs)$/;

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

const violations = [];
for (const group of ROOTS) {
  const groupDir = path.join(root, group);
  if (!fs.existsSync(groupDir)) continue;
  for (const srcDir of walkDirs(groupDir)) {
    for (const file of walkFiles(srcDir)) {
      const base = path.basename(file);
      if (!VALID.test(base)) violations.push(path.relative(root, file));
    }
  }
}

if (violations.length > 0) {
  console.error("Non-kebab-case source filenames:\n");
  for (const v of violations.sort()) console.error(`  ${v}`);
  console.error(
    `\n${violations.length} file(s) must match: name-with-dashes(.test|.worker|.d)?.(ts|tsx|js|mjs)`,
  );
  process.exit(1);
}

console.log("All source filenames are kebab-case.");
