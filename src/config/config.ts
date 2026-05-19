import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, TIMEOUT_MAX_MS, TIMEOUT_MIN_MS } from "./defaults.js";
import { getConfigDirectory, getConfigPath } from "./paths.js";
import type {
  ConfigStatus,
  ConfigValidationResult,
  RewriteHotkeyConfig,
  ValidationIssue
} from "./types.js";

const PLACEHOLDER_ENDPOINT = "https://YOUR-RESOURCE.openai.azure.com";
const HOTKEY_PART_SEPARATOR = "+";
const ALLOWED_MODIFIERS = new Set(["ctrl", "control", "alt", "shift", "meta", "win", "cmd", "command"]);

export function ensureConfigFile(): string {
  const directory = getConfigDirectory();
  const configPath = getConfigPath();

  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, DEFAULT_CONFIG);
  }

  return configPath;
}

export function loadConfig(): RewriteHotkeyConfig {
  const configPath = ensureConfigFile();
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<RewriteHotkeyConfig>;

  return normaliseConfig(parsed);
}

export function saveConfig(config: RewriteHotkeyConfig): void {
  const configPath = ensureConfigFile();
  writeJsonFile(configPath, normaliseConfig(config));
}

export function getConfigStatus(): ConfigStatus {
  const configPath = ensureConfigFile();
  const config = loadConfig();

  return {
    path: configPath,
    config,
    redactedConfig: redactConfig(config),
    validation: validateConfig(config)
  };
}

export function normaliseConfig(config: Partial<RewriteHotkeyConfig>): RewriteHotkeyConfig {
  return {
    enabled: coerceBoolean(config.enabled, DEFAULT_CONFIG.enabled),
    hotkey: coerceString(config.hotkey, DEFAULT_CONFIG.hotkey),
    azureOpenAIEndpoint: coerceString(config.azureOpenAIEndpoint, DEFAULT_CONFIG.azureOpenAIEndpoint),
    azureOpenAIApiKey: coerceString(config.azureOpenAIApiKey, DEFAULT_CONFIG.azureOpenAIApiKey),
    azureOpenAIDeployment: coerceString(config.azureOpenAIDeployment, DEFAULT_CONFIG.azureOpenAIDeployment),
    azureOpenAIApiVersion: coerceString(config.azureOpenAIApiVersion, DEFAULT_CONFIG.azureOpenAIApiVersion),
    screenshotContextEnabled: coerceBoolean(
      config.screenshotContextEnabled,
      DEFAULT_CONFIG.screenshotContextEnabled
    ),
    timeoutMs: coerceNumber(config.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    userStylePrompt: coerceString(config.userStylePrompt, DEFAULT_CONFIG.userStylePrompt),
    launchOnStartup: coerceBoolean(config.launchOnStartup, DEFAULT_CONFIG.launchOnStartup)
  };
}

export function validateConfig(config: RewriteHotkeyConfig): ConfigValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isUsableAzureEndpoint(config.azureOpenAIEndpoint)) {
    issues.push({
      field: "azureOpenAIEndpoint",
      message: "Azure OpenAI endpoint must be a real https://*.openai.azure.com URL."
    });
  }

  if (config.azureOpenAIApiKey.trim().length === 0) {
    issues.push({ field: "azureOpenAIApiKey", message: "Azure OpenAI API key is required." });
  }

  if (config.azureOpenAIDeployment.trim().length === 0) {
    issues.push({ field: "azureOpenAIDeployment", message: "Azure OpenAI deployment name is required." });
  }

  if (config.azureOpenAIApiVersion.trim().length === 0) {
    issues.push({ field: "azureOpenAIApiVersion", message: "Azure OpenAI API version is required." });
  }

  if (!isValidHotkey(config.hotkey)) {
    issues.push({
      field: "hotkey",
      message: "Rewrite Hotkey must include at least one modifier and one key, e.g. Ctrl+Alt+Space."
    });
  }

  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < TIMEOUT_MIN_MS || config.timeoutMs > TIMEOUT_MAX_MS) {
    issues.push({
      field: "timeoutMs",
      message: `Rewrite Timeout must be an integer between ${TIMEOUT_MIN_MS} and ${TIMEOUT_MAX_MS} milliseconds.`
    });
  }

  if (config.userStylePrompt.trim().length === 0) {
    issues.push({ field: "userStylePrompt", message: "Style Prompt must not be empty." });
  }

  return {
    isConfigured: issues.length === 0,
    issues
  };
}

export function redactConfig(config: RewriteHotkeyConfig): RewriteHotkeyConfig {
  return {
    ...config,
    azureOpenAIApiKey: redactSecret(config.azureOpenAIApiKey)
  };
}

function isUsableAzureEndpoint(endpoint: string): boolean {
  if (endpoint.trim() === "" || endpoint === PLACEHOLDER_ENDPOINT) {
    return false;
  }

  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && url.hostname.endsWith(".openai.azure.com");
  } catch {
    return false;
  }
}

function isValidHotkey(hotkey: string): boolean {
  const parts = hotkey
    .split(HOTKEY_PART_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return false;
  }

  const modifiers = parts.slice(0, -1);
  const key = parts.at(-1);

  return key !== undefined && key.length > 0 && modifiers.some((modifier) => ALLOWED_MODIFIERS.has(modifier.toLowerCase()));
}

function redactSecret(secret: string): string {
  const trimmed = secret.trim();

  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed.length <= 4) {
    return "****";
  }

  return `****${trimmed.slice(-4)}`;
}

function coerceString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function coerceNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
