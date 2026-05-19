import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import {
  canRegisterRewriteHotkey,
  canRunTestRewrite,
  canStartReplacementFlow,
  deriveRewriteAppState,
  deriveTrayMenuModel
} from "./app-state.js";

const CONFIGURED_CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("invalid configuration keeps the app running but does not register the Rewrite Hotkey", () => {
  const state = deriveRewriteAppState(DEFAULT_CONFIG);
  const menu = deriveTrayMenuModel(state);

  assert.equal(state.configured, false);
  assert.equal(state.enabled, true);
  assert.equal(state.hotkeyRegistrationAllowed, false);
  assert.equal(state.rewriteStatus, "configuration_required");
  assert.equal(canRegisterRewriteHotkey(state), false);
  assert.equal(canStartReplacementFlow(state), false);
  assert.equal(canRunTestRewrite(state), true);
  assert.equal(menu.statusLabel, "Settings required");
  assert.equal(menu.items.find((item) => item.id === "test_rewrite")?.enabled, true);
});

test("Disabled App state blocks Test Rewrite and replacement flow side effects", () => {
  const state = deriveRewriteAppState({
    ...CONFIGURED_CONFIG,
    enabled: false
  });
  const menu = deriveTrayMenuModel(state);

  assert.equal(state.configured, true);
  assert.equal(state.enabled, false);
  assert.equal(state.hotkeyRegistrationAllowed, false);
  assert.equal(state.rewriteStatus, "disabled");
  assert.equal(canRegisterRewriteHotkey(state), false);
  assert.equal(canStartReplacementFlow(state), false);
  assert.equal(canRunTestRewrite(state), false);
  assert.equal(menu.statusLabel, "Disabled");
  assert.equal(menu.items.find((item) => item.id === "enable")?.enabled, true);
  assert.equal(menu.items.find((item) => item.id === "disable")?.enabled, false);
  assert.equal(menu.items.find((item) => item.id === "test_rewrite")?.enabled, false);
});

test("Configured App state allows future hotkey registration and Test Rewrite", () => {
  const state = deriveRewriteAppState(CONFIGURED_CONFIG);
  const menu = deriveTrayMenuModel(state);

  assert.equal(state.configured, true);
  assert.equal(state.enabled, true);
  assert.equal(state.hotkeyRegistrationAllowed, true);
  assert.equal(state.rewriteStatus, "ready");
  assert.equal(canRegisterRewriteHotkey(state), true);
  assert.equal(canStartReplacementFlow(state), true);
  assert.equal(canRunTestRewrite(state), true);
  assert.equal(menu.statusLabel, "Ready");
  assert.equal(menu.items.find((item) => item.id === "disable")?.enabled, true);
  assert.equal(menu.items.find((item) => item.id === "test_rewrite")?.enabled, true);
});

test("In-Flight Rewrite state exposes subtle rewriting status without disabling tray actions", () => {
  const state = deriveRewriteAppState(CONFIGURED_CONFIG, { rewriteInFlight: true });
  const menu = deriveTrayMenuModel(state);

  assert.equal(state.rewriteStatus, "rewriting");
  assert.equal(canStartReplacementFlow(state), false);
  assert.equal(menu.statusLabel, "Rewriting...");
  assert.equal(menu.items.find((item) => item.id === "disable")?.enabled, true);
  assert.equal(menu.items.find((item) => item.id === "test_rewrite")?.enabled, true);
});
