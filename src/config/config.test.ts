import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "./defaults.js";
import { normaliseConfig, redactConfig, validateConfig } from "./config.js";

test("default config is intentionally not configured until Azure values are filled", () => {
  const validation = validateConfig(DEFAULT_CONFIG);

  assert.equal(validation.isConfigured, false);
  assert.deepEqual(
    validation.issues.map((issue) => issue.field),
    ["azureOpenAIEndpoint", "azureOpenAIApiKey", "azureOpenAIDeployment", "azureOpenAIApiVersion"]
  );
});

test("validates the live configuration fields required for a Configured App", () => {
  const config = {
    ...DEFAULT_CONFIG,
    azureOpenAIEndpoint: "https://rewrite-test.openai.azure.com",
    azureOpenAIApiKey: "test-key",
    azureOpenAIDeployment: "gpt-test",
    azureOpenAIApiVersion: "2025-01-01-preview"
  };

  assert.deepEqual(validateConfig(config), { isConfigured: true, issues: [] });
});

test("rejects invalid endpoint, hotkey, timeout, and empty Style Prompt", () => {
  const config = {
    ...DEFAULT_CONFIG,
    azureOpenAIEndpoint: "http://example.com",
    azureOpenAIApiKey: "test-key",
    azureOpenAIDeployment: "gpt-test",
    azureOpenAIApiVersion: "2025-01-01-preview",
    hotkey: "Space",
    timeoutMs: 1,
    userStylePrompt: "   "
  };

  assert.deepEqual(
    validateConfig(config).issues.map((issue) => issue.field),
    ["azureOpenAIEndpoint", "hotkey", "timeoutMs", "userStylePrompt"]
  );
});

test("redacts API key without removing other visible settings", () => {
  const config = {
    ...DEFAULT_CONFIG,
    azureOpenAIApiKey: "abc123456"
  };

  assert.equal(redactConfig(config).azureOpenAIApiKey, "****3456");
  assert.equal(redactConfig(config).azureOpenAIEndpoint, DEFAULT_CONFIG.azureOpenAIEndpoint);
});

test("normalises partial config with safe defaults", () => {
  const config = normaliseConfig({
    azureOpenAIEndpoint: "https://rewrite-test.openai.azure.com",
    timeoutMs: 45000,
    enabled: false
  });

  assert.equal(config.azureOpenAIEndpoint, "https://rewrite-test.openai.azure.com");
  assert.equal(config.timeoutMs, 45000);
  assert.equal(config.enabled, false);
  assert.equal(config.hotkey, DEFAULT_CONFIG.hotkey);
  assert.equal(config.screenshotContextEnabled, true);
});
