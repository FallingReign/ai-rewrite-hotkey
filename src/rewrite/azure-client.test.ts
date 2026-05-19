import assert from "node:assert/strict";
import test from "node:test";
import type { RewriteHotkeyConfig } from "../config/types.js";
import { DEFAULT_CONFIG } from "../config/defaults.js";
import { AzureRewriteClient, buildAzureChatCompletionsUrl } from "./azure-client.js";
import { RewriteSafeFailureError } from "./errors.js";
import { buildRewritePrompt } from "./prompt-builder.js";
import type { FetchLike } from "./types.js";

const CONFIG: RewriteHotkeyConfig = {
  ...DEFAULT_CONFIG,
  azureOpenAIEndpoint: "https://rewrite-test.cognitiveservices.azure.com/",
  azureOpenAIApiKey: "unit-test-key",
  azureOpenAIDeployment: "rewrite-deployment",
  azureOpenAIApiVersion: "2025-01-01-preview"
};

test("Azure Rewrite Client calls Azure Chat Completions direct REST using configured deployment and API version", async () => {
  const seen: Array<{ input: string | URL; init: RequestInit }> = [];
  const fetchFn: FetchLike = async (input, init) => {
    seen.push({ input, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Better text." } }] }), { status: 200 });
  };
  const prompt = buildRewritePrompt({ stylePrompt: "Make it clearer.", selectedText: "make this better" });

  const output = await new AzureRewriteClient(CONFIG, fetchFn).rewrite(prompt);

  assert.equal(output, "Better text.");
  assert.equal(seen.length, 1);
  assert.equal(
    String(seen[0]?.input),
    "https://rewrite-test.cognitiveservices.azure.com/openai/deployments/rewrite-deployment/chat/completions?api-version=2025-01-01-preview"
  );
  assert.equal(seen[0]?.init.method, "POST");
  assert.equal((seen[0]?.init.headers as Record<string, string>)["api-key"], "unit-test-key");
  assert.equal((seen[0]?.init.headers as Record<string, string>)["content-type"], "application/json");

  const body = JSON.parse(String(seen[0]?.init.body)) as Record<string, unknown>;
  assert.equal(body.model, undefined);
  assert.equal(Array.isArray(body.messages), true);
  assert.deepEqual(Object.keys(body), ["messages"]);
});

test("Azure Rewrite Client does not retry failed requests automatically", async () => {
  let attempts = 0;
  const fetchFn: FetchLike = async () => {
    attempts += 1;
    throw new Error("network unavailable");
  };
  const prompt = buildRewritePrompt({ stylePrompt: "Make it clearer.", selectedText: "make this better" });

  await assert.rejects(
    () => new AzureRewriteClient(CONFIG, fetchFn).rewrite(prompt),
    (error) => error instanceof RewriteSafeFailureError && error.category === "azure_network_error"
  );
  assert.equal(attempts, 1);
});

test("Azure Rewrite Client returns content-free HTTP failure categories", async () => {
  const fetchFn: FetchLike = async () => new Response("provider details omitted", { status: 429 });
  const prompt = buildRewritePrompt({ stylePrompt: "Make it clearer.", selectedText: "make this better" });

  await assert.rejects(
    () => new AzureRewriteClient(CONFIG, fetchFn).rewrite(prompt),
    (error) =>
      error instanceof RewriteSafeFailureError &&
      error.category === "azure_http_error" &&
      error.httpStatus === 429 &&
      !error.message.includes("provider details")
  );
});

test("Azure URL builder trims endpoint slashes and never adds a model query", () => {
  const url = buildAzureChatCompletionsUrl(CONFIG);

  assert.match(url, /\/openai\/deployments\/rewrite-deployment\/chat\/completions\?api-version=/);
  assert.doesNotMatch(url, /model=/);
});

