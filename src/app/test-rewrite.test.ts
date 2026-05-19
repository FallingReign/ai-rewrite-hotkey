import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import type { MetadataLogEvent } from "./metadata-log.js";
import { BUILT_IN_TEST_REWRITE_SAMPLE, runSafeTestRewrite } from "./test-rewrite.js";

const CONFIGURED_CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("Test Rewrite uses the built-in sample and returns only content-free success metadata", async () => {
  const replacementText = "This is clearer.";
  const logEvents: MetadataLogEvent[] = [];
  let requestBody = "";

  const outcome = await runSafeTestRewrite({
    config: CONFIGURED_CONFIG,
    logEvent: (event) => logEvents.push(event),
    fetchFn: async (_input, init) => {
      requestBody = String(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: replacementText } }] }), { status: 200 });
    }
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.code, "test_rewrite_succeeded");
  assert.equal(outcome.category, undefined);
  assert.equal(JSON.stringify(outcome).includes(replacementText), false);
  assert.equal(requestBody.includes(BUILT_IN_TEST_REWRITE_SAMPLE), true);
  assert.equal(JSON.stringify(logEvents).includes(BUILT_IN_TEST_REWRITE_SAMPLE), false);
  assert.equal(JSON.stringify(logEvents).includes(replacementText), false);
  assert.deepEqual(
    logEvents.map((event) => event.event),
    ["test_rewrite_started", "test_rewrite_finished"]
  );
  assert.equal(logEvents.at(-1)?.outcome, "succeeded");
});

test("invalid configuration fails safely without calling Azure", async () => {
  let azureCalls = 0;
  const logEvents: MetadataLogEvent[] = [];

  const outcome = await runSafeTestRewrite({
    config: DEFAULT_CONFIG,
    logEvent: (event) => logEvents.push(event),
    fetchFn: async () => {
      azureCalls += 1;
      return new Response("{}");
    }
  });

  assert.equal(azureCalls, 0);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "test_rewrite_safe_failure");
  assert.equal(outcome.category, "config_invalid");
  assert.equal(JSON.stringify(outcome).includes(BUILT_IN_TEST_REWRITE_SAMPLE), false);
  assert.equal(logEvents.at(-1)?.outcome, "safe_failure");
  assert.equal(logEvents.at(-1)?.category, "config_invalid");
});

test("Disabled App blocks Test Rewrite before Azure side effects", async () => {
  let azureCalls = 0;
  const logEvents: MetadataLogEvent[] = [];

  const outcome = await runSafeTestRewrite({
    config: {
      ...CONFIGURED_CONFIG,
      enabled: false
    },
    logEvent: (event) => logEvents.push(event),
    fetchFn: async () => {
      azureCalls += 1;
      return new Response("{}");
    }
  });

  assert.equal(azureCalls, 0);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "test_rewrite_blocked");
  assert.equal(outcome.category, "disabled_app");
  assert.equal(logEvents.length, 1);
  assert.equal(logEvents[0]?.outcome, "blocked");
  assert.equal(logEvents[0]?.category, "disabled_app");
});

test("Test Rewrite failures notify with content-free provider status class", async () => {
  const outcome = await runSafeTestRewrite({
    config: CONFIGURED_CONFIG,
    fetchFn: async () => new Response(JSON.stringify({ error: { message: "provider details are ignored" } }), { status: 401 })
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, "test_rewrite_safe_failure");
  assert.equal(outcome.category, "azure_http_error");
  assert.equal(outcome.providerStatusClass, "4xx");
  assert.equal(JSON.stringify(outcome).includes("provider details"), false);
});
