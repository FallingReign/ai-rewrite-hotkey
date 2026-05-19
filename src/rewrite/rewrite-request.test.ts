import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import type { RewriteHotkeyConfig } from "../config/types.js";
import { prepareTextOnlyRewriteRequest, runTextOnlyRewriteRequest, SELECTED_TEXT_MAX_CHARS } from "./rewrite-request.js";
import type { FetchLike } from "./types.js";

const CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("text-only Rewrite Request returns accepted Replacement Text from Azure output", async () => {
  const fetchFn: FetchLike = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "This is clearer." } }] }), { status: 200 });

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: CONFIG,
      selectedText: "this is maybe not clear",
      fetchFn
    }),
    {
      status: "replacement",
      replacementText: "This is clearer."
    }
  );
});

test("text-only Rewrite Request returns Safe Failure for invalid config without calling Azure", async () => {
  let calls = 0;
  const fetchFn: FetchLike = async () => {
    calls += 1;
    return new Response("{}");
  };

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: DEFAULT_CONFIG,
      selectedText: "text",
      fetchFn
    }),
    {
      status: "safe_failure",
      category: "config_invalid"
    }
  );
  assert.equal(calls, 0);
});

test("text-only Rewrite Request enforces selected text limits before Azure", () => {
  assert.deepEqual(prepareTextOnlyRewriteRequest("", CONFIG.userStylePrompt), {
    ok: false,
    category: "selected_text_empty"
  });

  assert.deepEqual(prepareTextOnlyRewriteRequest("x".repeat(SELECTED_TEXT_MAX_CHARS + 1), CONFIG.userStylePrompt), {
    ok: false,
    category: "selected_text_too_large"
  });
});

test("text-only Rewrite Request enforces no-op classification", async () => {
  const fetchFn: FetchLike = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "Same text." } }] }), { status: 200 });

  assert.deepEqual(
    await runTextOnlyRewriteRequest({
      config: CONFIG,
      selectedText: " Same text.\n",
      fetchFn
    }),
    { status: "noop" }
  );
});

