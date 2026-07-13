import { distillAndPack } from "./distill.js";
import { dumpData } from "./dump.js";

function usage(): never {
  console.error("Usage: pnpm -F @fpsr/pipeline run pipeline [dump|distill|pack|all] [--force]");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("-")) ?? "all";
  const force = args.includes("--force");

  if (!["dump", "distill", "pack", "all"].includes(cmd)) usage();

  if (cmd === "dump" || cmd === "all") {
    await dumpData({ force });
  }
  if (cmd === "distill" || cmd === "pack" || cmd === "all") {
    // distill + pack are one pass
    await distillAndPack();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
