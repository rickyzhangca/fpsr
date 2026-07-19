#!/usr/bin/env tsx

import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_PULL_ZONE_ID = "6179441";
const DEFAULT_VERSION = "2.1.11";
const DEFAULT_HOURS = 24;
const ENV_NAME = "VITE_FPSR_CDN_TOKEN_QUERY";
const ENV_FILE = path.join(REPO_ROOT, "apps/viewer/.env.local");

type PullZoneResponse = {
  Id?: number;
  Name?: string;
  ZoneSecurityKey?: string;
};

interface Options {
  hours: number;
  pullZoneId: string;
  version: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    hours: DEFAULT_HOURS,
    pullZoneId: DEFAULT_PULL_ZONE_ID,
    version: DEFAULT_VERSION,
  };

  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift();
    const value = rest.shift();
    if (arg === "--hours" && value) options.hours = Number(value);
    else if (arg === "--pull-zone" && value) options.pullZoneId = value;
    else if (arg === "--version" && value) options.version = value;
    else throw new Error(`Unknown or incomplete argument: ${arg ?? ""}`);
  }

  if (!Number.isFinite(options.hours) || options.hours <= 0 || options.hours > 168) {
    throw new Error("--hours must be greater than 0 and no more than 168");
  }
  if (!/^\d+$/.test(options.pullZoneId)) throw new Error("--pull-zone must be numeric");
  if (!/^\d+\.\d+\.\d+$/.test(options.version)) {
    throw new Error("--version must look like 2.1.11");
  }
  return options;
}

export function createBunnyDirectoryTokenQuery(
  securityKey: string,
  tokenPath: string,
  expires: number,
): string {
  if (!securityKey || /^\*+$/.test(securityKey)) {
    throw new Error("Bunny CLI did not return a usable Pull Zone security key");
  }
  if (!tokenPath.startsWith("/") || !tokenPath.endsWith("/")) {
    throw new Error("tokenPath must start and end with /");
  }
  if (!Number.isInteger(expires) || expires <= 0)
    throw new Error("expires must be a Unix timestamp");

  const signingData = `token_path=${tokenPath}`;
  const message = `${tokenPath}${expires}${signingData}`;
  const digest = createHmac("sha256", securityKey).update(message).digest("base64url");
  return new URLSearchParams({
    token: `HS256-${digest}`,
    expires: String(expires),
    token_path: tokenPath,
  }).toString();
}

export function upsertEnvValue(source: string, name: string, value: string): string {
  const replacement = `${name}=${value}`;
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = replacement;
  else lines.push(replacement);
  return `${lines
    .filter((line, lineIndex) => line !== "" || lineIndex !== 0)
    .join("\n")
    .replace(/\n*$/, "")}\n`;
}

async function readPullZone(pullZoneId: string): Promise<PullZoneResponse> {
  const bunnyCli =
    process.env.BUNNY_CLI?.trim() || path.join(os.homedir(), ".bunny", "bin", "bunny");
  const { stdout } = await execFileAsync(
    bunnyCli,
    ["api", "GET", `/pullzone/${pullZoneId}`, "--output", "json"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as PullZoneResponse;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const zone = await readPullZone(options.pullZoneId);
  if (String(zone.Id) !== options.pullZoneId || zone.Name !== "fpsr") {
    throw new Error(`Pull Zone ${options.pullZoneId} is not the expected fpsr zone`);
  }

  const expires = Math.floor(Date.now() / 1000 + options.hours * 60 * 60);
  const tokenPath = `/${options.version}/`;
  const query = createBunnyDirectoryTokenQuery(zone.ZoneSecurityKey ?? "", tokenPath, expires);
  const current = await readFile(ENV_FILE, "utf8").catch(() => "");
  await writeFile(ENV_FILE, upsertEnvValue(current, ENV_NAME, query), { mode: 0o600 });

  console.log(
    `Wrote a ${options.hours}-hour CDN debug token for ${tokenPath} to apps/viewer/.env.local`,
  );
  console.log(`Expires: ${new Date(expires * 1000).toISOString()}`);
  console.log("Restart the Vite dev server before switching the viewer to CDN assets.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
