import os from "node:os";
import path from "node:path";

const APP_DIRECTORY_NAME = "Rewrite Hotkey";
const CONFIG_FILE_NAME = "config.json";

export function getConfigDirectory(): string {
  const roamingAppData = process.env.APPDATA;
  const baseDirectory =
    roamingAppData && roamingAppData.trim().length > 0
      ? roamingAppData
      : path.join(os.homedir(), "AppData", "Roaming");

  return path.join(baseDirectory, APP_DIRECTORY_NAME);
}

export function getConfigPath(): string {
  return path.join(getConfigDirectory(), CONFIG_FILE_NAME);
}
