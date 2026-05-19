import { spawnSync } from "node:child_process";
import { ensureConfigFile, getConfigStatus } from "./config.js";
import { getConfigPath } from "./paths.js";

const command = process.argv[2] ?? "status";

switch (command) {
  case "init":
    printInit();
    break;
  case "open":
    openConfig();
    break;
  case "path":
    console.log(getConfigPath());
    break;
  case "status":
    printStatus();
    break;
  default:
    console.error(`Unknown config command: ${command}`);
    console.error("Use one of: init, open, path, status");
    process.exitCode = 1;
}

function printInit(): void {
  const configPath = ensureConfigFile();

  console.log("Rewrite Hotkey config is ready to edit.");
  console.log(configPath);
  console.log("");
  console.log("Fill in azureOpenAIEndpoint, azureOpenAIApiKey, azureOpenAIDeployment, and azureOpenAIApiVersion.");
  console.log("Do not commit or paste the local config contents anywhere.");
}

function openConfig(): void {
  const configPath = ensureConfigFile();

  if (process.platform === "win32") {
    spawnSync("notepad.exe", [configPath], { stdio: "inherit" });
    return;
  }

  console.log(configPath);
}

function printStatus(): void {
  const status = getConfigStatus();

  console.log(`Config path: ${status.path}`);
  console.log(`Configured App: ${status.validation.isConfigured ? "yes" : "no"}`);
  console.log("");
  console.log(JSON.stringify(status.redactedConfig, null, 2));

  if (status.validation.issues.length > 0) {
    console.log("");
    console.log("Issues:");
    for (const issue of status.validation.issues) {
      console.log(`- ${issue.field}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
}
