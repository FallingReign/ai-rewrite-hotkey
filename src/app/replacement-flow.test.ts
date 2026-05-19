import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import type { MetadataLogEvent } from "./metadata-log.js";
import { appendMetadataLogEvent } from "./metadata-log.js";
import { planReplacementFlowRewrite, toContentFreeReplacementFlowRewritePlan } from "./replacement-flow.js";

const CONFIGURED_CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("Replacement Flow plans a silent paste with preserved whitespace wrappers", async () => {
  const selectedText = " \nNeeds work.\r\n";
  const replacementText = "This is clearer.";
  let requestBody = "";

  const plan = await planReplacementFlowRewrite({
    config: CONFIGURED_CONFIG,
    selectedText,
    fetchFn: async (_input, init) => {
      requestBody = String(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: replacementText } }] }), { status: 200 });
    }
  });

  assert.equal(plan.action, "paste");
  assert.equal(plan.ok, true);
  if (plan.action !== "paste") {
    assert.fail("expected paste plan");
  }
  assert.equal(plan.pasteText, ` \n${replacementText}\r\n`);
  assert.equal(plan.metadata.leadingWrapperLength, 2);
  assert.equal(plan.metadata.trailingWrapperLength, 2);
  assert.equal(requestBody.includes("Needs work."), true);

  const contentFree = JSON.stringify(toContentFreeReplacementFlowRewritePlan(plan));
  assert.equal(contentFree.includes(selectedText), false);
  assert.equal(contentFree.includes(replacementText), false);
  assert.equal(contentFree.includes(plan.pasteText), false);
});

test("No-Op Rewrite restores without paste and notifies without private content", async () => {
  const selectedText = "  Keep this text.\n";

  const plan = await planReplacementFlowRewrite({
    config: CONFIGURED_CONFIG,
    selectedText,
    fetchFn: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Keep this text." } }] }), { status: 200 })
  });

  assert.equal(plan.action, "noop");
  assert.equal(plan.ok, true);
  assert.equal("pasteText" in plan, false);
  assert.match(plan.notificationTitle, /No changes suggested/);
  assert.equal(JSON.stringify(plan).includes(selectedText), false);
});

test("invalid Replacement Text becomes Safe Failure before paste", async () => {
  const plan = await planReplacementFlowRewrite({
    config: CONFIGURED_CONFIG,
    selectedText: "make this clearer",
    fetchFn: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"replacementText":"Clearer."}' } }] }), {
        status: 200
      })
  });

  assert.equal(plan.action, "restore");
  assert.equal(plan.ok, false);
  assert.equal(plan.category, "model_metadata_output");
  assert.equal("pasteText" in plan, false);
});

test("Azure failure becomes content-free Safe Failure with provider status class", async () => {
  const plan = await planReplacementFlowRewrite({
    config: CONFIGURED_CONFIG,
    selectedText: "make this clearer",
    fetchFn: async () => new Response(JSON.stringify({ error: { message: "ignored provider detail" } }), { status: 503 })
  });

  assert.equal(plan.action, "restore");
  assert.equal(plan.ok, false);
  assert.equal(plan.category, "azure_http_error");
  assert.equal(plan.providerStatusClass, "5xx");
  assert.equal(JSON.stringify(plan).includes("ignored provider detail"), false);
});

test("Replacement Flow metadata logs clipboard restore without private content", () => {
  const selectedText = "make this clearer";
  const replacementText = "This is clearer.";
  const outputDirectory = path.join(process.cwd(), ".test-output");
  const logPath = path.join(outputDirectory, "replacement-flow-metadata.jsonl");
  const event: MetadataLogEvent = {
    event: "replacement_flow_finished",
    outcome: "succeeded",
    targetCaptured: true,
    clipboardSnapshotCaptured: true,
    copySent: true,
    pasteSent: true,
    clipboardRestored: true,
    selectedTextCharLength: selectedText.length,
    usableTextCharLength: selectedText.length,
    replacementTextCharLength: replacementText.length,
    pasteTextCharLength: replacementText.length,
    durationMs: 750
  };

  try {
    appendMetadataLogEvent(event, logPath);
    const log = fs.readFileSync(logPath, "utf8");
    assert.match(log, /"clipboardRestored":true/);
    assert.match(log, /"pasteSent":true/);
    assert.equal(log.includes(selectedText), false);
    assert.equal(log.includes(replacementText), false);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});
