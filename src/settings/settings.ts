import { deriveRewriteAppState, deriveTrayMenuModel } from "../app/app-state.js";
import { ensureConfigFile, loadConfig, normaliseConfig, redactConfig, saveConfig, validateConfig } from "../config/config.js";
import type { ConfigValidationResult, RewriteHotkeyConfig } from "../config/types.js";
import { LOCKED_GUARDRAILS } from "../rewrite/prompt-builder.js";

export interface SettingsViewValues {
  enabled: boolean;
  hotkey: string;
  azureOpenAIEndpoint: string;
  azureOpenAIApiKeyPresent: boolean;
  azureOpenAIApiKeyRedacted: string;
  azureOpenAIDeployment: string;
  azureOpenAIApiVersion: string;
  screenshotContextEnabled: boolean;
  timeoutMs: number;
  userStylePrompt: string;
  launchOnStartup: boolean;
}

export interface SettingsViewModel {
  path: string;
  values: SettingsViewValues;
  validation: ConfigValidationResult;
  lockedGuardrails: string;
}

export interface SettingsCommandResponse {
  ok: boolean;
  kind: "settings_status" | "settings_save" | "settings_clear_api_key";
  settings: SettingsViewModel;
  state: ReturnType<typeof deriveRewriteAppState>;
  menu: ReturnType<typeof deriveTrayMenuModel>;
  hotkeyChanged?: boolean;
  launchOnStartupChanged?: boolean;
  notificationTitle?: string;
  notificationBody?: string;
}

export interface SettingsSaveDecision {
  candidate: RewriteHotkeyConfig;
  validation: ConfigValidationResult;
  hotkeyChanged: boolean;
  launchOnStartupChanged: boolean;
}

export function settingsStatusResponse(): SettingsCommandResponse {
  const config = loadConfig();
  return settingsResponse("settings_status", config, ensureConfigFile(), true);
}

export function settingsSaveResponse(draft: unknown): SettingsCommandResponse {
  const configPath = ensureConfigFile();
  const current = loadConfig();
  const decision = prepareSettingsSave(current, draft);

  if (!decision.validation.isConfigured) {
    return {
      ...settingsResponse("settings_save", decision.candidate, configPath, false),
      hotkeyChanged: decision.hotkeyChanged,
      launchOnStartupChanged: decision.launchOnStartupChanged,
      notificationTitle: "Settings not saved",
      notificationBody: "Fix the highlighted settings before enabling Rewrite Hotkey."
    };
  }

  saveConfig(decision.candidate);

  return {
    ...settingsResponse("settings_save", decision.candidate, configPath, true),
    hotkeyChanged: decision.hotkeyChanged,
    launchOnStartupChanged: decision.launchOnStartupChanged,
    notificationTitle: "Settings saved",
    notificationBody: "Rewrite Hotkey settings were updated."
  };
}

export function settingsClearApiKeyResponse(): SettingsCommandResponse {
  const configPath = ensureConfigFile();
  const config = clearApiKeyConfig(loadConfig());
  saveConfig(config);

  return {
    ...settingsResponse("settings_clear_api_key", config, configPath, true),
    notificationTitle: "API key cleared",
    notificationBody: "The stored Azure OpenAI API key was removed."
  };
}

export function clearApiKeyConfig(config: RewriteHotkeyConfig): RewriteHotkeyConfig {
  return {
    ...config,
    azureOpenAIApiKey: ""
  };
}

export function prepareSettingsSave(current: RewriteHotkeyConfig, draft: unknown): SettingsSaveDecision {
  const object = asRecord(draft);
  const candidate = normaliseConfig({
    enabled: booleanFromDraft(object.enabled, current.enabled),
    hotkey: stringFromDraft(object.hotkey, current.hotkey).trim(),
    azureOpenAIEndpoint: stringFromDraft(object.azureOpenAIEndpoint, current.azureOpenAIEndpoint).trim(),
    azureOpenAIApiKey: apiKeyFromDraft(object.azureOpenAIApiKey, current.azureOpenAIApiKey),
    azureOpenAIDeployment: stringFromDraft(object.azureOpenAIDeployment, current.azureOpenAIDeployment).trim(),
    azureOpenAIApiVersion: stringFromDraft(object.azureOpenAIApiVersion, current.azureOpenAIApiVersion).trim(),
    screenshotContextEnabled: booleanFromDraft(object.screenshotContextEnabled, current.screenshotContextEnabled),
    timeoutMs: numberFromDraft(object.timeoutMs, current.timeoutMs),
    userStylePrompt: stringFromDraft(object.userStylePrompt, current.userStylePrompt),
    launchOnStartup: booleanFromDraft(object.launchOnStartup, current.launchOnStartup)
  });

  return {
    candidate,
    validation: validateConfig(candidate),
    hotkeyChanged: candidate.hotkey !== current.hotkey,
    launchOnStartupChanged: candidate.launchOnStartup !== current.launchOnStartup
  };
}

export function settingsViewModel(config: RewriteHotkeyConfig, configPath: string): SettingsViewModel {
  const redacted = redactConfig(config);

  return {
    path: configPath,
    values: {
      enabled: config.enabled,
      hotkey: config.hotkey,
      azureOpenAIEndpoint: config.azureOpenAIEndpoint,
      azureOpenAIApiKeyPresent: config.azureOpenAIApiKey.trim().length > 0,
      azureOpenAIApiKeyRedacted: redacted.azureOpenAIApiKey,
      azureOpenAIDeployment: config.azureOpenAIDeployment,
      azureOpenAIApiVersion: config.azureOpenAIApiVersion,
      screenshotContextEnabled: config.screenshotContextEnabled,
      timeoutMs: config.timeoutMs,
      userStylePrompt: config.userStylePrompt,
      launchOnStartup: config.launchOnStartup
    },
    validation: validateConfig(config),
    lockedGuardrails: LOCKED_GUARDRAILS
  };
}

function settingsResponse(
  kind: SettingsCommandResponse["kind"],
  config: RewriteHotkeyConfig,
  configPath: string,
  ok: boolean
): SettingsCommandResponse {
  const state = deriveRewriteAppState(config);

  return {
    ok,
    kind,
    settings: settingsViewModel(config, configPath),
    state,
    menu: deriveTrayMenuModel(state)
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringFromDraft(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function apiKeyFromDraft(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function booleanFromDraft(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberFromDraft(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return fallback;
}
