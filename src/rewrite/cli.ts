import { loadConfig } from "../config/config.js";
import { runTextOnlyRewriteRequest } from "./rewrite-request.js";
import type { RewriteResult, SafeFailureCategory } from "./types.js";

const BUILT_IN_SAMPLE =
  "i think this is probably fine but it could be a bit clearer and less wordy before I send it";

async function main(): Promise<void> {
  console.log("Test Rewrite: live Azure text-only request using the built-in sample.");
  console.log("Output is content-free: no config, secrets, Selected Text, Replacement Text, or provider payloads are printed.");

  const result = await runTextOnlyRewriteRequest({
    config: loadConfig(),
    selectedText: BUILT_IN_SAMPLE
  });

  printResult(result);
  process.exitCode = result.status === "replacement" ? 0 : 1;
}

function printResult(result: RewriteResult): void {
  switch (result.status) {
    case "replacement":
      console.log("Result: replacement_text_accepted");
      console.log("Live text-only Rewrite Request succeeded.");
      return;
    case "noop":
      console.log("Result: no_op_rewrite");
      console.log("The model returned Replacement Text that was effectively identical to the Selected Text.");
      return;
    case "safe_failure":
      console.log("Result: safe_failure");
      console.log(`Category: ${result.category}`);
      if (result.httpStatus !== undefined) {
        console.log(`Provider status class: ${Math.floor(result.httpStatus / 100)}xx`);
      }
      console.log(`Likely cause: ${likelyCauseFor(result.category)}`);
      return;
  }
}

function likelyCauseFor(category: SafeFailureCategory): string {
  switch (category) {
    case "config_invalid":
      return "Local Azure configuration is missing or invalid.";
    case "selected_text_empty":
      return "No usable text was supplied to the text-only request.";
    case "selected_text_too_large":
    case "style_prompt_too_large":
    case "payload_too_large":
      return "The text-only request exceeded the configured V0 payload limits.";
    case "style_prompt_empty":
      return "The configured Style Prompt is empty.";
    case "azure_timeout":
      return "The configured Azure request timed out.";
    case "azure_network_error":
      return "The Azure resource could not be reached from this machine.";
    case "azure_http_error":
      return "Azure rejected the request; check resource access and configured Azure fields.";
    case "azure_malformed_response":
      return "Azure returned a response that was not a usable chat completion.";
    case "model_empty_output":
      return "The model returned no usable text.";
    case "model_explanatory_output":
      return "The model returned explanation instead of plain Replacement Text.";
    case "model_metadata_output":
      return "The model returned metadata instead of plain Replacement Text.";
    case "model_ambiguous_output":
      return "The model returned alternatives or another ambiguous output.";
    case "unexpected_error":
      return "An unexpected local failure occurred.";
  }
}

main().catch(() => {
  console.log("Result: safe_failure");
  console.log("Category: unexpected_error");
  console.log(`Likely cause: ${likelyCauseFor("unexpected_error")}`);
  process.exitCode = 1;
});

