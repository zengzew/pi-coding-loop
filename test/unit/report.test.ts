import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFinalReport } from "../../src/report.js";
import { persistReviewArtifact } from "../../src/orchestrator.js";
import type { FinalReportOptions } from "../../src/report.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("writeFinalReport", () => {
  it("records result, telemetry, verification, changes, timing, and stop reason", async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), "pi-loop-report-test-"));
    temporaryPaths.push(runDirectory);
    const options = reportOptions(runDirectory);

    const reportPath = await writeFinalReport(options);
    const report = await readFile(reportPath, "utf8");

    expect(reportPath).toBe(join(runDirectory, "final-report.md"));
    expect(report).toContain("Status: STOPPED");
    expect(report).toContain("Iterations: 2");
    expect(report).toContain("- test: FAIL");
    expect(report).toContain("Changed files: 2");
    expect(report).toContain("Input tokens: 100");
    expect(report).toContain("max_review_cycles");
  });
});

describe("persistReviewArtifact", () => {
  it("writes a numbered structured review below the run directory", async () => {
    const runDirectory = await mkdtemp(join(tmpdir(), "pi-loop-review-artifact-test-"));
    temporaryPaths.push(runDirectory);
    const artifacts = {
      runDirectory,
      statePath: join(runDirectory, "state.json"),
      eventsPath: join(runDirectory, "events.jsonl"),
    };

    await persistReviewArtifact(artifacts, 1, {
      decision: "approve",
      blockers: [],
      notes: ["complete"],
    });

    expect(
      JSON.parse(await readFile(join(runDirectory, "reviews", "review-01.json"), "utf8")),
    ).toEqual({ decision: "approve", blockers: [], notes: ["complete"] });
  });
});

function reportOptions(runDirectory: string): FinalReportOptions {
  const failedCheck = {
    name: "test",
    command: "npm test",
    passed: false,
    exitCode: 1,
    timedOut: false,
    stdoutBytes: 0,
    stderrBytes: 1,
    outputForModel: "failed",
    fullOutputPath: join(runDirectory, "test.log"),
    durationMs: 10,
  };
  return {
    state: {
      runId: "run-1",
      taskPath: "/repo/task.md",
      taskRequirements: "Task",
      repoRoot: "/repo",
      baseCommit: "abc123",
      status: "stopped",
      coderIteration: 2,
      reviewCycle: 2,
      repeatedFailureCount: 0,
      lastVerification: {
        passed: false,
        checks: [failedCheck],
        failedCheck,
        durationMs: 10,
      },
      startedAt: "2026-08-11T00:00:00.000Z",
      finishedAt: "2026-08-11T00:00:01.000Z",
      stopReason: "max_review_cycles",
    },
    artifacts: {
      runDirectory,
      statePath: join(runDirectory, "state.json"),
      eventsPath: join(runDirectory, "events.jsonl"),
    },
    baseline: { repoRoot: "/repo", baseCommit: "abc123", branch: "feature/test" },
    config: {
      coder: { provider: "deepseek", model: "deepseek-test" },
      reviewer: {
        provider: "moonshotai-cn",
        model: "kimi-test",
        protocolRetries: 1,
        maxPatchChars: 1000,
      },
      verification: {
        commands: [],
        maxModelOutputChars: 1000,
        headLines: 10,
        tailLines: 10,
      },
      limits: {
        maxCoderIterations: 4,
        maxReviewCycles: 2,
        sameFailureLimit: 3,
        maxTaskMinutes: 30,
      },
    },
    telemetry: {
      coder: {
        provider: "deepseek",
        model: "deepseek-test",
        messages: 2,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 10,
        cacheWriteTokens: 0,
        reportedCost: "unknown",
      },
      reviewer: {
        provider: "moonshotai-cn",
        model: "kimi-test",
        messages: 2,
        inputTokens: 80,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reportedCost: 0.01,
      },
      verifierRuns: 2,
      failedChecks: 1,
    },
    changes: {
      baseCommit: "abc123",
      trackedDiff: "diff",
      untrackedFiles: [{ path: "new.ts", binary: false, sizeBytes: 1, content: "x" }],
      changedPaths: ["new.ts", "value.ts"],
      totalChars: 4,
    },
  };
}
