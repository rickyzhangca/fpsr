import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ASSETS_OUT,
  DUMP_META_PATH,
  DUMP_PATH,
  DUMP_SOURCE,
  FACTORIO_BIN,
  GAME_VERSION,
  OFFICIAL_MODS,
  TEMP_MOD_DIR,
} from "./paths.js";

async function pathExists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    return false;
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

export async function dumpData(opts: { force?: boolean } = {}): Promise<void> {
  await mkdir(ASSETS_OUT, { recursive: true });

  if (!opts.force && (await pathExists(DUMP_PATH))) {
    console.log(`dump: skip (exists) ${DUMP_PATH}`);
    return;
  }

  await mkdir(TEMP_MOD_DIR, { recursive: true });
  const modList = {
    mods: OFFICIAL_MODS.map((name) => ({ name, enabled: true })),
  };
  await writeFile(
    path.join(TEMP_MOD_DIR, "mod-list.json"),
    `${JSON.stringify(modList, null, 2)}\n`,
  );

  console.log("dump: running factorio --dump-data (official mods only)…");
  await run(FACTORIO_BIN, ["--dump-data", "--disable-audio", "--mod-directory", TEMP_MOD_DIR]);

  if (!(await pathExists(DUMP_SOURCE))) {
    throw new Error(`Expected dump at ${DUMP_SOURCE} but it was not created`);
  }

  // Copy via read/write so we don't remove the game's copy unexpectedly.
  const buf = await readFile(DUMP_SOURCE);
  const tmp = `${DUMP_PATH}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, DUMP_PATH);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const meta = {
    sha256,
    gameVersion: GAME_VERSION,
    mods: [...OFFICIAL_MODS],
    source: DUMP_SOURCE,
    bytes: buf.byteLength,
  };
  await writeFile(DUMP_META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `dump: wrote ${DUMP_PATH} (${(buf.byteLength / 1e6).toFixed(1)} MB, sha256=${sha256.slice(0, 12)}…)`,
  );
}
