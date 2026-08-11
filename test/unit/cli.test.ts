import { describe, expect, it } from "vitest";
import { exitCodeForState, parseCliArguments } from "../../src/cli.js";
import type { LoopState, RunStatus } from "../../src/types.js";

describe("parseCliArguments", () => {
  it("parses the primary command and default config", () => {
    expect(parseCliArguments(["run", "task.md"], "/repo")).toEqual({
      taskPath: "task.md",
      configPath: "/repo/pi-loop.config.ts",
    });
  });

  it("parses an explicit config and rejects unknown arguments", () => {
    expect(
      parseCliArguments(["run", "task.md", "--config", "config/custom.ts"], "/repo"),
    ).toEqual({ taskPath: "task.md", configPath: "/repo/config/custom.ts" });
    expect(() => parseCliArguments(["run", "task.md", "--unknown"], "/repo")).toThrow(
      /Unknown/,
    );
  });
});

describe("exitCodeForState", () => {
  it.each([
    ["done", 0],
    ["stopped", 2],
    ["interrupted", 130],
    ["coding", 1],
  ] satisfies [RunStatus, number][])("maps %s to %i", (status, exitCode) => {
    expect(exitCodeForState(state(status))).toBe(exitCode);
  });
});

function state(status: RunStatus): LoopState {
  return {
    runId: "run",
    taskPath: "task.md",
    taskRequirements: "Task",
    repoRoot: "/repo",
    baseCommit: "abc",
    status,
    coderIteration: 0,
    reviewCycle: 0,
    repeatedFailureCount: 0,
    startedAt: "2026-08-11T00:00:00.000Z",
  };
}
