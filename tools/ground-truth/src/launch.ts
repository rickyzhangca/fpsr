import { type ChildProcess, spawn } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  FACTORIO_BIN,
  HARD_TIMEOUT_MS,
  RIG_SCRIPT_OUTPUT,
  SENTINEL_DONE,
  SENTINEL_ERROR,
  SENTINEL_SHOT,
  TERM_GRACE_MS,
} from "./paths.js";

export type LaunchResult = {
  pngSources: Map<string, string>;
  stdout: string;
};

function exists(p: string): Promise<boolean> {
  return access(p)
    .then(() => true)
    .catch(() => false);
}

function killProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

async function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  killProcess(child, "SIGTERM");
  const exited = await waitForExit(child, TERM_GRACE_MS);
  if (!exited) {
    console.log("ground-truth: SIGTERM grace elapsed; sending SIGKILL");
    killProcess(child, "SIGKILL");
    await waitForExit(child, 2_000);
  }
}

async function waitForPng(pngSource: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (await exists(pngSource)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return exists(pngSource);
}

/**
 * Launch Factorio once with the rig scenario, wait for all jobs to finish
 * (FPSR_RIG_DONE), then return paths to each screenshot under script-output.
 */
export async function launchAndCapture(opts: {
  modDir: string;
  names: string[];
  factorioBin?: string;
  /** Override hard timeout (ms). Defaults to HARD_TIMEOUT_MS + 30s per extra job. */
  timeoutMs?: number;
}): Promise<LaunchResult> {
  if (opts.names.length === 0) {
    throw new Error("launchAndCapture requires at least one name");
  }

  const args = [
    "--load-scenario",
    "fpsr-rig/rig",
    "--mod-directory",
    opts.modDir,
    "--disable-audio",
    "--disable-migration-window",
  ];

  const timeoutMs = opts.timeoutMs ?? HARD_TIMEOUT_MS + Math.max(0, opts.names.length - 1) * 30_000;

  const factorioBin = opts.factorioBin ?? FACTORIO_BIN;
  console.log(`ground-truth: launching ${factorioBin}`);
  console.log(`ground-truth: args: ${args.join(" ")}`);
  console.log(`ground-truth: expecting ${opts.names.length} shot(s): ${opts.names.join(", ")}`);

  const child = spawn(factorioBin, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let settled = false;
  let settleError: Error | null = null;
  const shotsSeen = new Set<string>();

  const settle = (err: Error | null) => {
    if (settled) return;
    settled = true;
    settleError = err;
  };

  const onChunk = (buf: Buffer, stream: "out" | "err") => {
    const text = buf.toString("utf8");
    stdout += text;
    for (const line of text.split(/\r?\n/)) {
      if (line.length === 0) continue;
      console.log(`factorio[${stream}]: ${line}`);
      if (line.includes(SENTINEL_DONE)) {
        settle(null);
      } else if (line.includes(SENTINEL_ERROR)) {
        settle(new Error(line.trim()));
      } else if (line.includes(SENTINEL_SHOT)) {
        const m = line.match(new RegExp(`${SENTINEL_SHOT}:(\\S+)`));
        if (m?.[1]) {
          shotsSeen.add(m[1]);
          console.log(`ground-truth: shot ready (${shotsSeen.size}/${opts.names.length}): ${m[1]}`);
        }
      } else if (
        line.includes("Failed to load mods") ||
        line.includes("Failed to load mod") ||
        line.includes("Incompatible Factorio version")
      ) {
        settle(new Error(`Factorio mod load failure: ${line.trim()}`));
        void terminate(child);
      }
    }
  };

  child.stdout.on("data", (b: Buffer) => onChunk(b, "out"));
  child.stderr.on("data", (b: Buffer) => onChunk(b, "err"));
  child.on("error", (err) => settle(err));
  child.on("exit", (code, signal) => {
    if (!settled) {
      settle(
        new Error(
          `Factorio exited before sentinel (code=${code}, signal=${signal}). Last output:\n${stdout.slice(-2000)}`,
        ),
      );
    }
  });

  const hardTimer = setTimeout(() => {
    console.error(`ground-truth: hard timeout (${timeoutMs}ms) — killing Factorio`);
    settle(new Error(`hard timeout after ${timeoutMs}ms`));
    void terminate(child);
  }, timeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (!settled) return;
        clearInterval(poll);
        if (settleError) reject(settleError);
        else resolve();
      }, 50);
    });
  } finally {
    clearTimeout(hardTimer);
  }

  const pngSources = new Map<string, string>();
  for (const name of opts.names) {
    const pngSource = path.join(RIG_SCRIPT_OUTPUT, `${name}.png`);
    if (!(await waitForPng(pngSource))) {
      await terminate(child);
      throw new Error(`Screenshot not found at ${pngSource}`);
    }
    pngSources.set(name, pngSource);
    console.log(`ground-truth: screenshot ready at ${pngSource}`);
  }

  await terminate(child);
  return { pngSources, stdout };
}

export async function copyToFixtures(
  pngSource: string,
  name: string,
  outDir: string,
): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const dest = path.join(outDir, `${name}.game.png`);
  await copyFile(pngSource, dest);
  console.log(`ground-truth: wrote ${dest}`);
  return dest;
}
