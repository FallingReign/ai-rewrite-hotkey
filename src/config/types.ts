export interface RewriteHotkeyConfig {
  enabled: boolean;
  hotkey: string;
  azureOpenAIEndpoint: string;
  azureOpenAIApiKey: string;
  azureOpenAIDeployment: string;
  azureOpenAIApiVersion: string;
  screenshotContextEnabled: boolean;
  timeoutMs: number;
  userStylePrompt: string;
  launchOnStartup: boolean;
}

export interface ValidationIssue {
  field: keyof RewriteHotkeyConfig;
  message: string;
}

export interface ConfigValidationResult {
  isConfigured: boolean;
  issues: ValidationIssue[];
}

export interface ConfigStatus {
  path: string;
  config: RewriteHotkeyConfig;
  redactedConfig: RewriteHotkeyConfig;
  validation: ConfigValidationResult;
}
