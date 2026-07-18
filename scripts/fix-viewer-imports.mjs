import fs from "node:fs";
import path from "node:path";

const srcRoot = path.resolve("apps/viewer/src");

const moduleIndex = new Map();
for (const dir of walkDirs(srcRoot)) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    const base = entry.name.replace(/\.(ts|tsx)$/, "");
    const full = path.join(dir, entry.name);
    const rel = path
      .relative(srcRoot, full)
      .replace(/\\/g, "/")
      .replace(/\.(ts|tsx)$/, "");
    if (!moduleIndex.has(base)) moduleIndex.set(base, []);
    moduleIndex.get(base).push(rel);
  }
}

function walkDirs(root) {
  const out = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules") {
      out.push(...walkDirs(path.join(root, entry.name)));
    }
  }
  return out;
}

function resolveLocal(dir, importPath) {
  const base = importPath.slice(2);
  const candidates = [
    path.join(dir, `${base}.ts`),
    path.join(dir, `${base}.tsx`),
    path.join(dir, base, "index.ts"),
    path.join(dir, base, "index.tsx"),
  ];
  return candidates.some((candidate) => fs.existsSync(candidate));
}

function toAlias(relPath) {
  return `@/${relPath}`;
}

function fixFile(filePath) {
  const dir = path.dirname(filePath);
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;

  const next = content.replace(/from (['"])(\.\/[^'"]+)\1/g, (match, quote, importPath) => {
    if (resolveLocal(dir, importPath)) return match;

    const base = importPath.slice(2).split("/").pop();
    const matches = moduleIndex.get(base);
    if (!matches || matches.length !== 1) return match;

    changed = true;
    return `from ${quote}${toAlias(matches[0])}${quote}`;
  });

  if (changed) {
    fs.writeFileSync(filePath, next);
    console.log(path.relative(process.cwd(), filePath));
  }
}

for (const dir of walkDirs(srcRoot)) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    fixFile(path.join(dir, entry.name));
  }
}
