import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FACTORIO_BIN } from "./paths.js";

export interface ExactProfile {
  gameVersion: string;
  mods: readonly string[];
}

export interface AssetProfile {
  schema: number;
  gameVersion: string;
  mods: string[];
  dir: string;
}

export function parseFactorioVersion(output: string): string {
  const match = output.match(/^Version:\s*([^\s(]+)/m);
  if (!match?.[1]) {
    throw new Error(`Cannot parse Factorio version from output:\n${output.trim()}`);
  }
  return match[1];
}

export function inspectFactorioVersion(factorioBin = FACTORIO_BIN): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(factorioBin, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${factorioBin} --version exited with code ${code}\n${output.trim()}`));
        return;
      }
      try {
        resolve(parseFactorioVersion(output));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function assertFactorioVersion(
  expectedVersion: string,
  factorioBin = FACTORIO_BIN,
): Promise<string> {
  const actualVersion = await inspectFactorioVersion(factorioBin);
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Factorio version mismatch: suite requires ${expectedVersion}, but ${factorioBin} is ${actualVersion}. ` +
        "Refusing to create mislabeled game references.",
    );
  }
  return actualVersion;
}

export async function readAssetProfile(dir: string): Promise<AssetProfile> {
  const root = path.resolve(dir);
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as {
    schema?: unknown;
    gameVersion?: unknown;
    mods?: unknown;
  };
  if (
    manifest.schema !== 2 ||
    typeof manifest.gameVersion !== "string" ||
    !Array.isArray(manifest.mods) ||
    !manifest.mods.every((mod) => typeof mod === "string")
  ) {
    throw new Error(`Invalid schema-2 asset profile at ${root}`);
  }
  return {
    schema: manifest.schema,
    gameVersion: manifest.gameVersion,
    mods: [...manifest.mods],
    dir: root,
  };
}

export function assertExactProfile(
  actual: Pick<AssetProfile, "gameVersion" | "mods">,
  expected: ExactProfile,
  label = "Asset profile",
): void {
  const sameVersion = actual.gameVersion === expected.gameVersion;
  const sameMods =
    actual.mods.length === expected.mods.length &&
    actual.mods.every((mod, index) => mod === expected.mods[index]);
  if (sameVersion && sameMods) return;
  throw new Error(
    `${label} mismatch: expected Factorio ${expected.gameVersion} [${expected.mods.join(", ")}], ` +
      `got ${actual.gameVersion} [${actual.mods.join(", ")}].`,
  );
}

export async function assertAssetProfile(
  dir: string,
  expected: ExactProfile,
): Promise<AssetProfile> {
  const actual = await readAssetProfile(dir);
  assertExactProfile(actual, expected, `Asset profile at ${actual.dir}`);
  return actual;
}
