import type { RewriteHotkeyConfig } from "./types.js";

export const DEFAULT_STYLE_PROMPT =
  "Make the selected text clearer, shorter, and more useful. Keep it sounding like me. Use Australian English. Avoid corporate fluff. Preserve uncertainty when I sound uncertain.";

export const DEFAULT_CONFIG: RewriteHotkeyConfig = {
  enabled: true,
  hotkey: "Ctrl+Alt+Space",
  azureOpenAIEndpoint: "https://YOUR-RESOURCE.openai.azure.com",
  azureOpenAIApiKey: "",
  azureOpenAIDeployment: "",
  azureOpenAIApiVersion: "",
  screenshotContextEnabled: true,
  timeoutMs: 30000,
  userStylePrompt: DEFAULT_STYLE_PROMPT,
  launchOnStartup: false
};

export const TIMEOUT_MIN_MS = 3000;
export const TIMEOUT_MAX_MS = 120000;
