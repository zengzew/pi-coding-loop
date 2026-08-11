#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { collectChanges } from "./changes.js";
import { createDeepSeekCoder, type DeepSeekCoder } from "./coder.js";
import { ConfigurationError, loadConfig, type ConfigInput } from "./config.js";
import { runStateMachine } from "./orchestrator.js";
import {
  PreflightError,
  appendRunEvent,
  persistState,
  runPreflight,
  type PreflightResult,
} from "./preflight.js";
import { writeFinalReport } from "./report.js";
import { modelTelemetry } from "./telemetry.js";
import { createKimiReviewer, type KimiReviewer } from "./reviewer.js";
import type { LoopState, PiLoopConfig, RunTelemetry } from "./types.js";
import { runVerification } from "./verifier.js";

export interface CliArguments {
  taskPath: string;
  configPath: string;
}

export class CliUsageError extends Error {
  override readonly name = "CliUsageError";
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
): Promise<number> {
  let coder: DeepSeekCoder | undefined;
  let reviewer: KimiReviewer | undefined;
  let preflight: PreflightResult | undefined;
  let config: PiLoopConfig | undefined;
  const cancellation = new AbortController();
  const onInterrupt = () => cancellation.abort();
  process.once("SIGINT", onInterrupt);

  try {
    const args = parseCliArguments(argv, cwd);
    const configInput = await loadConfigModule(args.configPath);
    const activeConfig = loadConfig(configInput, process.env);
    config = activeConfig;
    preflight = await runPreflight({
      cwd,
      taskPath: args.taskPath,
      config: activeConfig,
      env: process.env,
    });

    coder = await createDeepSeekCoder({
      repoRoot: preflight.baseline.repoRoot,
      model: activeConfig.coder.model,
      apiKey: process.env.DEEPSEEK_API_KEY!,
    });
    reviewer = await createKimiReviewer({
      repoRoot: preflight.baseline.repoRoot,
      model: activeConfig.reviewer.model,
      apiKey: process.env.KIMI_API_KEY!,
      protocolRetries: activeConfig.reviewer.protocolRetries,
    });

    let verifierRuns = 0;
    let failedChecks = 0;
    const result = await runStateMachine({
      state: preflight.state,
      artifacts: preflight.artifacts,
      config: activeConfig,
      coder,
      reviewer,
      verify: async (signal) => {
        verifierRuns++;
        const verification = await runVerification({
          repoRoot: preflight!.baseline.repoRoot,
          artifacts: preflight!.artifacts,
          config: activeConfig.verification,
          signal,
        });
        failedChecks += verification.checks.filter((check) => !check.passed).length;
        return verification;
      },
      collectChanges: () =>
        collectChanges(preflight!.baseline.repoRoot, preflight!.baseline.baseCommit),
      signal: cancellation.signal,
    });
    const telemetry = createTelemetry(
      activeConfig.coder.model,
      activeConfig.reviewer.model,
      coder,
      reviewer,
      verifierRuns,
      failedChecks,
    );
    await writeFinalReport({
      state: result.state,
      artifacts: preflight.artifacts,
      baseline: preflight.baseline,
      config: activeConfig,
      telemetry,
      ...(result.changes ? { changes: result.changes } : {}),
    });
    return exitCodeForState(result.state);
  } catch (error) {
    if (
      error instanceof CliUsageError ||
      error instanceof ConfigurationError ||
      error instanceof PreflightError
    ) {
      process.stderr.write(`${error.message}\n`);
      return 3;
    }
    if (preflight) {
      await persistUnexpectedStop(preflight, error);
      if (config) {
        try {
          await writeFinalReport({
            state: preflight.state,
            artifacts: preflight.artifacts,
            baseline: preflight.baseline,
            config,
            telemetry: createTelemetry(
              config.coder.model,
              config.reviewer.model,
              coder,
              reviewer,
              0,
              0,
            ),
          });
        } catch {
          // State and stop event are already durable; preserve the original failure classification.
        }
      }
      process.stderr.write("Pi Loop stopped because the harness environment failed.\n");
      return 2;
    }
    process.stderr.write(`Unexpected Pi Loop failure: ${errorMessage(error)}\n`);
    return 1;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    reviewer?.dispose();
    coder?.dispose();
  }
}

export function parseCliArguments(argv: string[], cwd: string): CliArguments {
  if (argv[0] !== "run" || !argv[1]) {
    throw new CliUsageError("Usage: pi-loop run task.md [--config ./pi-loop.config.ts]");
  }
  let configPath = resolve(cwd, "pi-loop.config.ts");
  for (let index = 2; index < argv.length; index++) {
    const argument = argv[index];
    if (argument !== "--config" || !argv[index + 1]) {
      throw new CliUsageError(`Unknown or incomplete argument: ${argument ?? ""}`);
    }
    configPath = resolve(cwd, argv[index + 1]!);
    index++;
  }
  return { taskPath: argv[1], configPath };
}

export function exitCodeForState(state: LoopState): number {
  if (state.status === "done") return 0;
  if (state.status === "interrupted") return 130;
  if (state.status === "stopped") return 2;
  return 1;
}

async function loadConfigModule(configPath: string): Promise<ConfigInput> {
  try {
    await access(configPath);
    const module = (await tsImport(pathToFileURL(configPath).href, import.meta.url)) as {
      default?: unknown;
    };
    if (!module.default || typeof module.default !== "object") {
      throw new Error("Config module must have a default object export.");
    }
    return module.default as ConfigInput;
  } catch (error) {
    throw new ConfigurationError(`Could not load Pi Loop config: ${configPath}`, {
      cause: error,
    });
  }
}

function createTelemetry(
  coderModel: string,
  reviewerModel: string,
  coder: DeepSeekCoder | undefined,
  reviewer: KimiReviewer | undefined,
  verifierRuns: number,
  failedChecks: number,
): RunTelemetry {
  return {
    coder: coder
      ? modelTelemetry("deepseek", coderModel, coder.stats)
      : emptyModelTelemetry("deepseek", coderModel),
    reviewer: reviewer
      ? modelTelemetry("moonshotai-cn", reviewerModel, reviewer.stats)
      : emptyModelTelemetry("moonshotai-cn", reviewerModel),
    verifierRuns,
    failedChecks,
  };
}

function emptyModelTelemetry(provider: string, model: string): RunTelemetry["coder"] {
  return {
    provider,
    model,
    messages: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reportedCost: "unknown",
  };
}

async function persistUnexpectedStop(
  preflight: PreflightResult,
  error: unknown,
): Promise<void> {
  preflight.state.status = "stopped";
  preflight.state.stopReason = "environment_failure";
  preflight.state.finishedAt = new Date().toISOString();
  await persistState(preflight.artifacts, preflight.state);
  await appendRunEvent(preflight.artifacts, {
    eventId: randomUUID(),
    runId: preflight.runId,
    type: "run_stopped",
    timestamp: preflight.state.finishedAt,
    data: { reason: "environment_failure", error: errorName(error) },
  });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
