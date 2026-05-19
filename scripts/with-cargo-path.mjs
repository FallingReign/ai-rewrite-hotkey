import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/with-cargo-path.mjs <command> [...args]");
  process.exit(1);
}

const cargoBin = path.join(os.homedir(), ".cargo", "bin");
const pathSeparator = process.platform === "win32" ? ";" : ":";
const existingPath = process.env.PATH ?? "";

if (fs.existsSync(cargoBin) && !existingPath.split(pathSeparator).includes(cargoBin)) {
  process.env.PATH = `${cargoBin}${pathSeparator}${existingPath}`;
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
