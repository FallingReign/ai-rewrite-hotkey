import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import type { MetadataLogEvent } from "./metadata-log.js";
import { appendMetadataLogEvent } from "./metadata-log.js";
import {
  ReplacementFlowController,
  planReplacementFlowRewrite,
  runReplacementFlow,
  toContentFreeReplacementFlowRewritePlan,
  type ReplacementFlowNativePrimitives
} from "./replacement-flow.js";

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

test("Rewrite Timeout cancels Azure work and returns Safe Failure without a late paste", async () => {
  const plan = await planReplacementFlowRewrite({
    config: CONFIGURED_CONFIG,
    selectedText: "make this clearer",
    timer: {
      setTimeout(callback) {
        callback();
        return "timeout";
      },
      clearTimeout() {}
    },
    fetchFn: async (_input, init) => {
      assert.equal(init.signal?.aborted, true);
      return new Response(JSON.stringify({ choices: [{ message: { content: "Late replacement." } }] }), { status: 200 });
    }
  });

  assert.equal(plan.action, "restore");
  assert.equal(plan.ok, false);
  assert.equal(plan.category, "azure_timeout");
  assert.equal("pasteText" in plan, false);
});

test("Replacement Flow restores and discards Replacement Text when Rewrite Target changes before paste", async () => {
  const operations: string[] = [];
  const native = createNativeFixture({
    isForegroundTarget: async () => false,
    writeClipboardPlainText: async () => {
      operations.push("write");
    },
    sendPaste: async () => {
      operations.push("paste");
    },
    restoreClipboardSnapshot: async () => {
      operations.push("restore");
    }
  });

  const result = await runReplacementFlow({
    config: CONFIGURED_CONFIG,
    native,
    fetchFn: async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 })
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, "safe_failure");
  assert.equal(result.category, "rewrite_target_changed");
  assert.deepEqual(operations, ["restore"]);
  assert.equal(JSON.stringify(result).includes("This is clearer."), false);
});

test("Replacement Flow cancellation restores the Clipboard Snapshot and discards late results", async () => {
  const controller = new AbortController();
  const operations: string[] = [];
  const native = createNativeFixture({
    restoreClipboardSnapshot: async () => {
      operations.push("restore");
    }
  });

  const resultPromise = runReplacementFlow({
    config: CONFIGURED_CONFIG,
    native,
    abortSignal: controller.signal,
    fetchFn: async () => {
      controller.abort();
      return new Response(JSON.stringify({ choices: [{ message: { content: "Late replacement." } }] }), { status: 200 });
    }
  });

  const result = await resultPromise;

  assert.equal(result.ok, false);
  assert.equal(result.outcome, "safe_failure");
  assert.equal(result.category, "disabled_app");
  assert.deepEqual(operations, ["restore"]);
  assert.equal(JSON.stringify(result).includes("Late replacement."), false);
});

test("ReplacementFlowController ignores a second in-flight rewrite and reports status changes", async () => {
  const statuses: string[] = [];
  const notifications: string[] = [];
  let releaseFetch: ((value: Response) => void) | undefined;
  let markFetchStarted: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });
  const native = createNativeFixture();
  const controller = new ReplacementFlowController({
    setStatus(status) {
      statuses.push(status);
    },
    notify(title) {
      notifications.push(title);
    }
  });

  const first = controller.start({
    config: CONFIGURED_CONFIG,
    native,
    fetchFn: async () => {
      markFetchStarted?.();
      return new Promise<Response>((resolve) => {
        releaseFetch = resolve;
      });
    }
  });
  await fetchStarted;
  const second = await controller.start({
    config: CONFIGURED_CONFIG,
    native,
    fetchFn: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Should not run." } }] }))
  });

  assert.equal(second.outcome, "ignored");
  assert.deepEqual(notifications, ["Rewrite already in progress"]);
  assert.deepEqual(statuses, ["in_flight"]);

  releaseFetch?.(new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 }));
  const firstResult = await first;

  assert.equal(firstResult.outcome, "succeeded");
  assert.deepEqual(statuses, ["in_flight", "idle"]);
});

function createNativeFixture(
  overrides: Partial<ReplacementFlowNativePrimitives> = {}
): ReplacementFlowNativePrimitives {
  let currentTime = 0;

  return {
    captureForegroundTarget: async () => ({ id: "target-1" }),
    captureClipboardSnapshot: async () => ({ id: "snapshot-1", previousPlainText: "previous" }),
    sendCopy: async () => {},
    readClipboardPlainText: async () => "make this clearer",
    writeClipboardPlainText: async () => {},
    sendPaste: async () => {},
    restoreClipboardSnapshot: async () => {},
    isForegroundTarget: async () => true,
    sleep: async (ms) => {
      currentTime += ms;
    },
    now: () => currentTime,
    ...overrides
  };
}
