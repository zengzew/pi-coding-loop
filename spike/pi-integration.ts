import {
  ModelRuntime,
  SessionManager,
  createAgentSession,
  defineTool,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateReviewResult } from "../src/feedback.js";
import type { ReviewResult } from "../src/types.js";

type ResultStatus = "PASS" | "FAIL" | "SKIPPED";

interface SpikeResult {
  status: ResultStatus;
  evidence: string;
}

interface UsageObservation {
  provider: string;
  model: string;
  responseModel: string | undefined;
  stopReason: string;
  errorMessage: string | undefined;
  usage: unknown;
}

const results: Record<string, SpikeResult> = {
  "DeepSeek provider resolution": skipped("DeepSeek checks were not started."),
  "DeepSeek session reuse": skipped("DeepSeek checks were not started."),
  "DeepSeek usage visibility": skipped("DeepSeek checks were not started."),
  "Kimi provider resolution": skipped("Kimi checks were not started."),
  "Reviewer tool allowlist": skipped("Kimi checks were not started."),
  "submit_review custom tool": skipped("Kimi checks were not started."),
  "Kimi usage visibility": skipped("Kimi checks were not started."),
};

const reviewParameters = Type.Object({
  decision: Type.Union([Type.Literal("approve"), Type.Literal("changes_requested")]),
  blockers: Type.Array(
    Type.Object({
      id: Type.String(),
      file: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
      issue: Type.String(),
      evidence: Type.String(),
      suggestedFix: Type.Optional(Type.String()),
    }),
  ),
  notes: Type.Array(Type.String()),
});

async function main(): Promise<void> {
  const fixtureDir = await mkdtemp(join(tmpdir(), "pi-loop-spike-"));
  await writeFile(join(fixtureDir, "fixture.txt"), "state=alpha\n", "utf8");

  try {
    const modelRuntime = await ModelRuntime.create();
    await runDeepSeekChecks(modelRuntime, fixtureDir);
    await writeFile(join(fixtureDir, "fixture.txt"), "review_target=stable\n", "utf8");
    await runKimiChecks(modelRuntime, fixtureDir);
  } finally {
    await writeResults();
    await rm(fixtureDir, { recursive: true, force: true });
  }

  printResults();
  if (Object.values(results).some((result) => result.status === "FAIL")) {
    process.exitCode = 1;
  }
}

async function runDeepSeekChecks(modelRuntime: ModelRuntime, fixtureDir: string): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const configuredModel = process.env.DEEPSEEK_CODER_MODEL?.trim();
  if (!apiKey || !configuredModel) {
    const missing = missingNames({ DEEPSEEK_API_KEY: apiKey, DEEPSEEK_CODER_MODEL: configuredModel });
    const evidence = `Missing ${missing.join(", ")}; no DeepSeek provider call was made.`;
    results["DeepSeek provider resolution"] = skipped(evidence);
    results["DeepSeek session reuse"] = skipped(evidence);
    results["DeepSeek usage visibility"] = skipped(evidence);
    return;
  }

  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  const usageEvents: UsageObservation[] = [];
  try {
    await modelRuntime.setRuntimeApiKey("deepseek", apiKey, { allowNetwork: false });
    const model = resolveConfiguredModel(modelRuntime, "deepseek", configuredModel);
    results["DeepSeek provider resolution"] = passed(`Resolved deepseek/${model.id}.`);

    ({ session } = await createAgentSession({
      cwd: fixtureDir,
      model,
      modelRuntime,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
      sessionManager: SessionManager.inMemory(fixtureDir),
    }));
    unsubscribe = observeUsage("DeepSeek", session, usageEvents);
    const originalSessionId = session.sessionId;

    await session.prompt(
      "Read fixture.txt, then make exactly one change: replace state=alpha with state=beta. Do not create other files.",
    );
    const firstContent = await readFile(join(fixtureDir, "fixture.txt"), "utf8");
    if (!firstContent.includes("state=beta")) {
      throw new Error(
        latestProviderError(usageEvents) ?? "First prompt did not make the expected fixture change.",
      );
    }

    await session.prompt(
      "Verifier feedback for the same task: the required final value is gamma, not beta. Re-inspect the file and make the smallest correction. Do not create other files.",
    );
    const secondContent = await readFile(join(fixtureDir, "fixture.txt"), "utf8");
    if (session.sessionId !== originalSessionId || !secondContent.includes("state=gamma")) {
      throw new Error(
        latestProviderError(usageEvents) ??
          "The repeated prompt did not complete in the same session as expected.",
      );
    }
    results["DeepSeek session reuse"] = passed(
      `Two prompts completed in session ${originalSessionId}; the second corrected the first change.`,
    );

    const stats = session.getSessionStats();
    results["DeepSeek usage visibility"] = usageEvents.length > 0 && stats.tokens.total > 0
      ? passed(`Observed ${usageEvents.length} assistant usage event(s), ${stats.tokens.total} total tokens.`)
      : failed("The provider ran, but no non-zero usage was observable.");
  } catch (error) {
    markUnfinishedDeepSeekFailed(error);
  } finally {
    unsubscribe?.();
    session?.dispose();
  }
}

async function runKimiChecks(modelRuntime: ModelRuntime, fixtureDir: string): Promise<void> {
  const apiKey = process.env.KIMI_API_KEY?.trim();
  const configuredModel = process.env.KIMI_REVIEWER_MODEL?.trim();
  if (!apiKey || !configuredModel) {
    const missing = missingNames({ KIMI_API_KEY: apiKey, KIMI_REVIEWER_MODEL: configuredModel });
    const evidence = `Missing ${missing.join(", ")}; no Kimi provider call was made.`;
    results["Kimi provider resolution"] = skipped(evidence);
    results["Reviewer tool allowlist"] = skipped(evidence);
    results["submit_review custom tool"] = skipped(evidence);
    results["Kimi usage visibility"] = skipped(evidence);
    return;
  }

  let submittedReview: ReviewResult | undefined;
  const submitReviewTool = defineTool({
    name: "submit_review",
    label: "Submit Review",
    description: "Submit the single final structured review result.",
    parameters: reviewParameters,
    execute: async (_toolCallId, parameters) => {
      if (submittedReview) throw new Error("submit_review may only be called once");
      submittedReview = validateReviewResult(parameters);
      return {
        content: [{ type: "text", text: "Review accepted." }],
        details: { accepted: true },
        terminate: true,
      };
    },
  });

  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  const usageEvents: UsageObservation[] = [];
  try {
    await modelRuntime.setRuntimeApiKey("moonshotai-cn", apiKey, { allowNetwork: false });
    const model = resolveConfiguredModel(modelRuntime, "moonshotai-cn", configuredModel);
    results["Kimi provider resolution"] = passed(`Resolved moonshotai-cn/${model.id}.`);

    ({ session } = await createAgentSession({
      cwd: fixtureDir,
      model,
      modelRuntime,
      tools: ["read", "grep", "find", "ls", "submit_review"],
      customTools: [submitReviewTool],
      sessionManager: SessionManager.inMemory(fixtureDir),
    }));
    unsubscribe = observeUsage("Kimi", session, usageEvents);

    const activeTools = session.getActiveToolNames().sort();
    const expectedTools = ["find", "grep", "ls", "read", "submit_review"];
    if (
      activeTools.join(",") !== expectedTools.join(",") ||
      activeTools.some((name) => ["bash", "edit", "write"].includes(name))
    ) {
      throw new Error(`Unexpected reviewer tools: ${activeTools.join(", ")}`);
    }
    results["Reviewer tool allowlist"] = passed(`Active tools: ${activeTools.join(", ")}.`);

    await session.prompt(
      [
        "Independently review the fixture directory.",
        "Use the available read-only tools to inspect fixture.txt and confirm it contains review_target=stable.",
        "This fixture is correct, so submit an approval with no blockers and a short note.",
        "Finish by calling submit_review exactly once.",
      ].join("\n"),
    );

    if (!submittedReview) {
      throw new Error(
        latestProviderError(usageEvents) ?? "Kimi completed without calling submit_review.",
      );
    }
    results["submit_review custom tool"] = passed(
      `Captured and validated decision=${submittedReview.decision}.`,
    );

    const stats = session.getSessionStats();
    results["Kimi usage visibility"] = usageEvents.length > 0 && stats.tokens.total > 0
      ? passed(`Observed ${usageEvents.length} assistant usage event(s), ${stats.tokens.total} total tokens.`)
      : failed("The provider ran, but no non-zero usage was observable.");
  } catch (error) {
    markUnfinishedKimiFailed(error);
  } finally {
    unsubscribe?.();
    session?.dispose();
  }
}

function resolveConfiguredModel(
  modelRuntime: ModelRuntime,
  provider: "deepseek" | "moonshotai-cn",
  configuredModel: string,
) {
  const prefix = `${provider}/`;
  const modelId = configuredModel.startsWith(prefix)
    ? configuredModel.slice(prefix.length)
    : configuredModel;
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) {
    const available = modelRuntime.getModels(provider).map((item) => item.id).join(", ");
    throw new Error(`Unknown ${provider} model "${configuredModel}". Available: ${available || "none"}`);
  }
  return model;
}

function observeUsage(
  label: string,
  session: AgentSession,
  usageEvents: UsageObservation[],
): () => void {
  return session.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const observation = {
        provider: event.message.provider,
        model: event.message.model,
        responseModel: event.message.responseModel,
        stopReason: event.message.stopReason,
        errorMessage:
          typeof event.message.errorMessage === "string"
            ? redactSecrets(event.message.errorMessage)
            : undefined,
        usage: event.message.usage,
      };
      usageEvents.push(observation);
      console.log(`[${label}] usage`, observation);
    }
  });
}

function latestProviderError(events: UsageObservation[]): string | undefined {
  return [...events].reverse().find((event) => event.errorMessage)?.errorMessage;
}

function redactSecrets(value: string): string {
  let redacted = value;
  for (const secret of [process.env.DEEPSEEK_API_KEY, process.env.KIMI_API_KEY]) {
    if (secret) redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

function markUnfinishedDeepSeekFailed(error: unknown): void {
  const evidence = errorMessage(error);
  for (const check of [
    "DeepSeek provider resolution",
    "DeepSeek session reuse",
    "DeepSeek usage visibility",
  ]) {
    if (results[check]?.status !== "PASS") results[check] = failed(evidence);
  }
}

function markUnfinishedKimiFailed(error: unknown): void {
  const evidence = errorMessage(error);
  for (const check of [
    "Kimi provider resolution",
    "Reviewer tool allowlist",
    "submit_review custom tool",
    "Kimi usage visibility",
  ]) {
    if (results[check]?.status !== "PASS") results[check] = failed(evidence);
  }
}

async function writeResults(): Promise<void> {
  const rows = Object.entries(results)
    .map(([check, result]) => `| ${check.replace("submit_review", "`submit_review`")} | ${result.status} | ${escapeTable(result.evidence)} |`)
    .join("\n");
  const report = `# Step 0 Pi Integration Spike Results

Date: ${new Date().toISOString()}

Only checks actually exercised are marked PASS. Missing configuration is SKIPPED, and provider or protocol errors are FAIL.

| Check | Result | Evidence |
|---|---|---|
${rows}

## Pi API differences from the V1 spec

- Verified against \`@earendil-works/pi-coding-agent\` 0.82.1.
- The current SDK expects an explicit \`Model\` object. This spike resolves it through \`ModelRuntime.create()\` and \`modelRuntime.getModel(provider, modelId)\`, then passes both \`modelRuntime\` and \`model\` to \`createAgentSession()\`.
- \`SessionManager.inMemory()\` accepts an optional working directory; this spike passes the fixture directory.
- Active tool names can be asserted directly with \`session.getActiveToolNames()\`.
- Runtime API keys are installed with \`allowNetwork: false\`; the packaged model catalog is sufficient for configured model resolution and avoids an unrelated remote-catalog refresh blocking session startup.
- Per-call provider/model/usage is observed from assistant \`message_end\` events; aggregate tokens and reported cost are available through \`session.getSessionStats()\`.
`;
  await writeFile(new URL("../docs/spike-results.md", import.meta.url), report, "utf8");
}

function printResults(): void {
  console.log("\nPi Integration Spike");
  for (const [check, result] of Object.entries(results)) {
    console.log(`${check}: ${result.status} — ${result.evidence}`);
  }
}

function missingNames(values: Record<string, string | undefined>): string[] {
  return Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
}

function passed(evidence: string): SpikeResult {
  return { status: "PASS", evidence };
}

function failed(evidence: string): SpikeResult {
  return { status: "FAIL", evidence };
}

function skipped(evidence: string): SpikeResult {
  return { status: "SKIPPED", evidence };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

await main();
