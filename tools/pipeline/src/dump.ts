import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPipelinePaths, OFFICIAL_MODS } from "./paths.js";

async function pathExists(filename: string): Promise<boolean> {
  try {
    await readFile(filename);
    return true;
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function dumpMatchesProfile(
  metaPath: string,
  version: string,
  mods: readonly string[],
): Promise<boolean> {
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
      gameVersion?: unknown;
      mods?: unknown;
    };
    return meta.gameVersion === version && JSON.stringify(meta.mods) === JSON.stringify(mods);
  } catch {
    return false;
  }
}

export async function dumpData(opts: { force?: boolean } = {}): Promise<void> {
  const paths = getPipelinePaths();
  await mkdir(paths.assetsOut, { recursive: true });

  if (
    !opts.force &&
    (await pathExists(paths.dumpPath)) &&
    (await dumpMatchesProfile(paths.dumpMetaPath, paths.install.version, paths.mods))
  ) {
    console.log(`dump: skip (${paths.install.version} exists) ${paths.dumpPath}`);
    return;
  }

  await mkdir(paths.tempModDir, { recursive: true });
  const officialNames = OFFICIAL_MODS as readonly string[];
  const modList = [
    ...OFFICIAL_MODS.map((name) => ({ name, enabled: paths.mods.includes(name) })),
    ...paths.mods
      .filter((name) => !officialNames.includes(name))
      .map((name) => ({ name, enabled: true })),
  ];
  await writeFile(
    path.join(paths.tempModDir, "mod-list.json"),
    `${JSON.stringify({ mods: modList }, null, 2)}\n`,
  );

  console.log(
    `dump: running ${paths.install.binary} --dump-data (profile ${paths.profileId}: ${paths.mods.join(", ")})…`,
  );
  await run(paths.install.binary, [
    "--dump-data",
    "--disable-audio",
    "--mod-directory",
    paths.tempModDir,
  ]);

  if (!(await pathExists(paths.dumpSource))) {
    throw new Error(`Expected dump at ${paths.dumpSource} but it was not created`);
  }

  const buf = await readFile(paths.dumpSource);
  const temporary = `${paths.dumpPath}.tmp`;
  await writeFile(temporary, buf);
  await rename(temporary, paths.dumpPath);

  const sha256 = createHash("sha256").update(buf).digest("hex");
  const meta = {
    sha256,
    gameVersion: paths.install.version,
    mods: [...paths.mods],
    source: paths.dumpSource,
    bytes: buf.byteLength,
  };
  await writeFile(paths.dumpMetaPath, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `dump: wrote ${paths.dumpPath} (${(buf.byteLength / 1e6).toFixed(1)} MB, sha256=${sha256.slice(0, 12)}…)`,
  );
}
