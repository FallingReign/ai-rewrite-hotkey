import { appendMetadataLogEvent } from "../app/metadata-log.js";
import { runSafeTestRewrite } from "../app/test-rewrite.js";
import { loadConfig } from "../config/config.js";

async function main(): Promise<void> {
  console.log("Test Rewrite: live Azure text-only request using the built-in sample.");
  console.log("Output is content-free: no config, secrets, Selected Text, Replacement Text, or provider payloads are printed.");

  const outcome = await runSafeTestRewrite({
    config: loadConfig(),
    logEvent: appendMetadataLogEvent
  });

  printOutcome(outcome);
  process.exitCode = outcome.ok ? 0 : 1;
}

function printOutcome(outcome: Awaited<ReturnType<typeof runSafeTestRewrite>>): void {
  console.log(`Result: ${outcome.code}`);
  console.log(outcome.notificationTitle);
  console.log(outcome.notificationBody);

  if (outcome.category !== undefined) {
    console.log(`Category: ${outcome.category}`);
  }

  if (outcome.providerStatusClass !== undefined) {
    console.log(`Provider status class: ${outcome.providerStatusClass}`);
  }
}

main().catch(() => {
  console.log("Result: test_rewrite_safe_failure");
  console.log("Test Rewrite failed safely");
  console.log("Category: unexpected_error");
  console.log("No private rewrite content was shown or logged.");
  process.exitCode = 1;
});

