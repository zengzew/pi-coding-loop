import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  ChangeSet,
  LoopState,
  PiLoopConfig,
  RunArtifacts,
  RunBaseline,
  RunTelemetry,
} from "./types.js";

export interface FinalReportOptions {
  state: LoopState;
  artifacts: RunArtifacts;
  baseline: RunBaseline;
  config: PiLoopConfig;
  telemetry: RunTelemetry;
  changes?: ChangeSet;
}

export async function writeFinalReport(options: FinalReportOptions): Promise<string> {
  const reportPath = join(options.artifacts.runDirectory, "final-report.md");
  const { state, telemetry } = options;
  const verificationLines = state.lastVerification?.checks.length
    ? state.lastVerification.checks
        .map(
          (check) =>
            `- ${check.name}: ${check.passed ? "PASS" : "FAIL"}${check.timedOut ? " (timeout)" : ""}`,
        )
        .join("\n")
    : "- No verification result recorded.";
  const changedFileCount = options.changes?.changedPaths.length ?? 0;
  const untrackedCount = options.changes?.untrackedFiles.length ?? 0;
  const duration = durationText(state.startedAt, state.finishedAt);

  const report = `# Pi Coding Loop Run

## Result
Status: ${state.status.toUpperCase()}
Task: ${basename(state.taskPath)}
Run: ${state.runId}

## Baseline
Base commit: ${options.baseline.baseCommit}
Branch: ${options.baseline.branch ?? "detached HEAD"}

## Coder
Provider: ${telemetry.coder.provider}
Model: ${telemetry.coder.model}
Iterations: ${state.coderIteration}
LLM messages: ${telemetry.coder.messages}
Input tokens: ${telemetry.coder.inputTokens}
Output tokens: ${telemetry.coder.outputTokens}
Cache read tokens: ${telemetry.coder.cacheReadTokens}
Cache write tokens: ${telemetry.coder.cacheWriteTokens}
Reported cost: ${formatCost(telemetry.coder.reportedCost)}

## Verifier
Runs: ${telemetry.verifierRuns}
Failed checks: ${telemetry.failedChecks}
${verificationLines}

## Reviewer
Provider: ${telemetry.reviewer.provider}
Model: ${telemetry.reviewer.model}
Review cycles: ${state.reviewCycle}
Decision: ${state.lastReview?.decision ?? "N/A"}
LLM messages: ${telemetry.reviewer.messages}
Input tokens: ${telemetry.reviewer.inputTokens}
Output tokens: ${telemetry.reviewer.outputTokens}
Cache read tokens: ${telemetry.reviewer.cacheReadTokens}
Cache write tokens: ${telemetry.reviewer.cacheWriteTokens}
Reported cost: ${formatCost(telemetry.reviewer.reportedCost)}

## Changes
Changed files: ${changedFileCount}
Untracked/new files: ${untrackedCount}

## Timing
Started: ${state.startedAt}
Finished: ${state.finishedAt ?? "N/A"}
Duration: ${duration}

## Stop Reason
${state.stopReason ?? "N/A"}
`;
  await writeFile(reportPath, report, "utf8");
  return reportPath;
}

function durationText(startedAt: string, finishedAt: string | undefined): string {
  if (!finishedAt) return "N/A";
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(durationMs) && durationMs >= 0 ? `${durationMs} ms` : "N/A";
}

function formatCost(cost: number | "unknown"): string {
  return cost === "unknown" ? "unknown" : String(cost);
}
