import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { LOCKED_GUARDRAILS } from "../rewrite/prompt-builder.js";
import { clearApiKeyConfig, prepareSettingsSave, settingsViewModel } from "./settings.js";

const CONFIGURED = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "secret-key-1234",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("settings view model redacts API key and exposes Locked Guardrails as read-only text", () => {
  const view = settingsViewModel(CONFIGURED, "C:\\Users\\example\\config.json");

  assert.equal(view.values.azureOpenAIApiKeyPresent, true);
  assert.equal(view.values.azureOpenAIApiKeyRedacted, "****1234");
  assert.equal(JSON.stringify(view).includes("secret-key-1234"), false);
  assert.equal(view.lockedGuardrails, LOCKED_GUARDRAILS);
  assert.equal("lockedGuardrails" in view.values, false);
});

test("settings save keeps the stored API key when the UI key field is blank", () => {
  const decision = prepareSettingsSave(CONFIGURED, {
    azureOpenAIApiKey: "",
    hotkey: "Ctrl+Shift+Space"
  });

  assert.equal(decision.candidate.azureOpenAIApiKey, CONFIGURED.azureOpenAIApiKey);
  assert.equal(decision.candidate.hotkey, "Ctrl+Shift+Space");
  assert.equal(decision.hotkeyChanged, true);
  assert.equal(decision.validation.isConfigured, true);
});

test("settings save validates timeout bounds, Style Prompt, and Rewrite Hotkey before saving", () => {
  const decision = prepareSettingsSave(CONFIGURED, {
    hotkey: "Space",
    timeoutMs: 1,
    userStylePrompt: "   "
  });

  assert.equal(decision.validation.isConfigured, false);
  assert.deepEqual(
    decision.validation.issues.map((issue) => issue.field),
    ["hotkey", "timeoutMs", "userStylePrompt"]
  );
});

test("settings save persists screenshot and launch-on-startup toggles in the candidate config", () => {
  const decision = prepareSettingsSave(CONFIGURED, {
    screenshotContextEnabled: false,
    launchOnStartup: true
  });

  assert.equal(decision.candidate.screenshotContextEnabled, false);
  assert.equal(decision.candidate.launchOnStartup, true);
  assert.equal(decision.launchOnStartupChanged, true);
  assert.equal(decision.validation.isConfigured, true);
});

test("settings save accepts a replacement API key without exposing it in the view model", () => {
  const decision = prepareSettingsSave(CONFIGURED, {
    azureOpenAIApiKey: "new-secret-key-5678"
  });
  const view = settingsViewModel(decision.candidate, "C:\\Users\\example\\config.json");

  assert.equal(decision.candidate.azureOpenAIApiKey, "new-secret-key-5678");
  assert.equal(view.values.azureOpenAIApiKeyRedacted, "****5678");
  assert.equal(JSON.stringify(view).includes("new-secret-key-5678"), false);
});

test("clear API key removes the stored key while leaving other settings unchanged", () => {
  const cleared = clearApiKeyConfig(CONFIGURED);

  assert.equal(cleared.azureOpenAIApiKey, "");
  assert.equal(cleared.azureOpenAIEndpoint, CONFIGURED.azureOpenAIEndpoint);
  assert.equal(cleared.hotkey, CONFIGURED.hotkey);
});

test("cancelled settings edits can be discarded because save preparation does not mutate current config", () => {
  const before = structuredClone(CONFIGURED);
  prepareSettingsSave(CONFIGURED, {
    hotkey: "Ctrl+Shift+Space",
    screenshotContextEnabled: false
  });

  assert.deepEqual(CONFIGURED, before);
});
