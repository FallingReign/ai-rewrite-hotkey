import { validateConfig } from "../config/config.js";
import type { RewriteHotkeyConfig } from "../config/types.js";

export type RewriteStatus = "ready" | "configuration_required" | "disabled" | "rewriting";

export interface RewriteAppState {
  enabled: boolean;
  configured: boolean;
  hotkeyRegistrationAllowed: boolean;
  rewriteStatus: RewriteStatus;
}

export interface RewriteRuntimeState {
  rewriteInFlight?: boolean;
}

export interface TrayMenuItemModel {
  id: "enable" | "disable" | "open_settings" | "test_rewrite" | "quit";
  label: string;
  enabled: boolean;
}

export interface TrayMenuModel {
  statusLabel: string;
  items: TrayMenuItemModel[];
}

export function deriveRewriteAppState(config: RewriteHotkeyConfig, runtime: RewriteRuntimeState = {}): RewriteAppState {
  const configured = validateConfig(config).isConfigured;
  const enabled = config.enabled;
  const hotkeyRegistrationAllowed = enabled && configured;
  const rewriteStatus = runtime.rewriteInFlight && hotkeyRegistrationAllowed ? "rewriting" : enabled ? (configured ? "ready" : "configuration_required") : "disabled";

  return {
    enabled,
    configured,
    hotkeyRegistrationAllowed,
    rewriteStatus
  };
}

export function deriveTrayMenuModel(state: RewriteAppState): TrayMenuModel {
  return {
    statusLabel: statusLabelFor(state),
    items: [
      {
        id: "enable",
        label: "Enable Rewrite Hotkey",
        enabled: !state.enabled
      },
      {
        id: "disable",
        label: "Disable Rewrite Hotkey",
        enabled: state.enabled
      },
      {
        id: "open_settings",
        label: "Open Settings",
        enabled: true
      },
      {
        id: "test_rewrite",
        label: "Test Rewrite",
        enabled: canRunTestRewrite(state)
      },
      {
        id: "quit",
        label: "Quit",
        enabled: true
      }
    ]
  };
}

export function canRegisterRewriteHotkey(state: RewriteAppState): boolean {
  return state.hotkeyRegistrationAllowed;
}

export function canStartReplacementFlow(state: RewriteAppState): boolean {
  return state.hotkeyRegistrationAllowed && state.rewriteStatus !== "rewriting";
}

export function canRunTestRewrite(state: RewriteAppState): boolean {
  return state.enabled;
}

export function withEnabled(config: RewriteHotkeyConfig, enabled: boolean): RewriteHotkeyConfig {
  return {
    ...config,
    enabled
  };
}

function statusLabelFor(state: RewriteAppState): string {
  switch (state.rewriteStatus) {
    case "ready":
      return "Ready";
    case "rewriting":
      return "Rewriting...";
    case "configuration_required":
      return "Settings required";
    case "disabled":
      return "Disabled";
  }
}
