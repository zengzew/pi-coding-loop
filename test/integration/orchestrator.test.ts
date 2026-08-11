import { describe, expect, it, vi } from "vitest";
import { runStateMachine } from "../../src/orchestrator.js";
import { ReviewerProtocolError } from "../../src/reviewer.js";
import type { CoderTurnInput } from "../../src/coder.js";
import type { ReviewerTurnInput } from "../../src/reviewer.js";
import type {
  ChangeSet,
  LoopState,
  PiLoopConfig,
  RunEvent,
  ReviewResult,
  VerificationResult,
} from "../../src/types.js";

describe("runStateMachine", () => {
  it("stops on an equivalent repeated verification failure before the coder cap", async () => {
    const harness = fixture();
    harness.config.limits.sameFailureLimit = 2;
    harness.config.limits.maxCoderIterations = 4;
    harness.verify.mockResolvedValue(failedVerification("same failure"));

    const result = await runStateMachine(harness.options());

    expect(result.state).toMatchObject({
      status: "stopped",
      stopReason: "repeated_verification_failure",
      coderIteration: 2,
      repeatedFailureCount: 2,
    });
    expect(harness.coder.run).toHaveBeenCalledTimes(2);
    expect(harness.reviewer.run).not.toHaveBeenCalled();
  });

  it("returns review blockers to Coder and stops at the review cycle limit", async () => {
    const harness = fixture();
    harness.config.limits.maxReviewCycles = 2;
    harness.verify.mockResolvedValue(passingVerification());
    harness.reviewer.run.mockResolvedValue({
      decision: "changes_requested",
      blockers: [{ id: "R1", issue: "Bug", evidence: "Failing edge case" }],
      notes: [],
    });

    const result = await runStateMachine(harness.options());

    expect(result.state).toMatchObject({
      status: "stopped",
      stopReason: "max_review_cycles",
      coderIteration: 2,
      reviewCycle: 2,
    });
    expect(harness.coder.run.mock.calls[1]?.[0]).toMatchObject({
      feedback: { type: "review_blockers" },
    });
    expect(harness.verify).toHaveBeenCalledTimes(2);
    expect(harness.reviewer.run).toHaveBeenCalledTimes(2);
  });

  it("marks DONE only after passing verification and approval", async () => {
    const harness = fixture();
    harness.verify.mockResolvedValue(passingVerification());
    harness.reviewer.run.mockResolvedValue({ decision: "approve", blockers: [], notes: [] });

    const result = await runStateMachine(harness.options());

    expect(result.state.status).toBe("done");
    expect(result.state.lastVerification?.passed).toBe(true);
    expect(result.state.lastReview?.decision).toBe("approve");
    expect(result.state.stopReason).toBeUndefined();
    expect(harness.events.map((event) => event.type)).toEqual([
      "coder_started",
      "coder_completed",
      "verification_completed",
      "review_started",
      "review_completed",
      "run_completed",
    ]);
  });

  it("maps a failed Reviewer protocol to its stable stop reason", async () => {
    const harness = fixture();
    harness.verify.mockResolvedValue(passingVerification());
    harness.reviewer.run.mockRejectedValue(new ReviewerProtocolError("missing submission"));

    const result = await runStateMachine(harness.options());

    expect(result.state).toMatchObject({
      status: "stopped",
      stopReason: "reviewer_protocol_error",
    });
  });

  it("stops before Reviewer when the exact review input is too large", async () => {
    const harness = fixture();
    harness.config.reviewer.maxPatchChars = 4;
    harness.verify.mockResolvedValue(passingVerification());

    const result = await runStateMachine(harness.options());

    expect(result.state.stopReason).toBe("review_input_too_large");
    expect(harness.reviewer.run).not.toHaveBeenCalled();
  });

  it("gives the global task timeout precedence over iteration limits", async () => {
    const harness = fixture();
    harness.state.startedAt = "2026-08-11T00:00:00.000Z";
    harness.state.coderIteration = harness.config.limits.maxCoderIterations;
    harness.now.mockReturnValue(new Date("2026-08-11T01:00:00.000Z"));

    const result = await runStateMachine(harness.options());

    expect(result.state.stopReason).toBe("max_task_time");
    expect(harness.coder.run).not.toHaveBeenCalled();
  });

  it("aborts active Coder work when the wall-clock deadline arrives", async () => {
    const harness = fixture();
    harness.config.limits.maxTaskMinutes = 1;
    harness.state.startedAt = "2026-08-10T23:59:00.010Z";
    harness.now.mockReturnValue(new Date("2026-08-11T00:00:00.000Z"));
    harness.coder.run.mockImplementation(() => new Promise<void>(() => undefined));

    const result = await runStateMachine(harness.options());

    expect(result.state.stopReason).toBe("max_task_time");
    expect(harness.coder.abort).toHaveBeenCalledOnce();
  });

  it("aborts the active session and persists interrupted state", async () => {
    const harness = fixture();
    const controller = new AbortController();
    harness.coder.run.mockImplementation(() => new Promise<void>(() => undefined));
    const running = runStateMachine(harness.options({ signal: controller.signal }));
    controller.abort();

    const result = await running;

    expect(result.state.status).toBe("interrupted");
    expect(result.state.stopReason).toBeUndefined();
    expect(harness.coder.abort).toHaveBeenCalledOnce();
    expect(harness.events.at(-1)?.type).toBe("run_interrupted");
  });
});

function fixture() {
  const state: LoopState = {
    runId: "run-1",
    taskPath: "/repo/task.md",
    taskRequirements: "Implement the task.",
    repoRoot: "/repo",
    baseCommit: "abc123",
    status: "coding",
    coderIteration: 0,
    reviewCycle: 0,
    repeatedFailureCount: 0,
    startedAt: "2026-08-11T00:00:00.000Z",
  };
  const config: PiLoopConfig = {
    coder: { provider: "deepseek", model: "deepseek-test" },
    reviewer: {
      provider: "moonshotai-cn",
      model: "kimi-test",
      protocolRetries: 1,
      maxPatchChars: 10_000,
    },
    verification: {
      commands: [],
      maxModelOutputChars: 1_000,
      headLines: 10,
      tailLines: 10,
    },
    limits: {
      maxCoderIterations: 4,
      maxReviewCycles: 2,
      sameFailureLimit: 3,
      maxTaskMinutes: 30,
    },
  };
  const coder = {
    sessionId: "coder-session",
    run: vi.fn(async (_input: CoderTurnInput): Promise<void> => undefined),
    abort: vi.fn(async (): Promise<void> => undefined),
  };
  const reviewer = {
    run: vi.fn(
      async (_input: ReviewerTurnInput): Promise<ReviewResult> => ({
        decision: "approve",
        blockers: [],
        notes: [],
      }),
    ),
    abort: vi.fn(async (): Promise<void> => undefined),
  };
  const verify = vi.fn(async (_signal: AbortSignal) => passingVerification());
  const changes: ChangeSet = {
    baseCommit: "abc123",
    trackedDiff: "diff\n",
    untrackedFiles: [],
    changedPaths: ["value.ts"],
    totalChars: 5,
  };
  const collectChanges = vi.fn(async () => changes);
  const events: RunEvent[] = [];
  const persisted: LoopState[] = [];
  const now = vi.fn(() => new Date("2026-08-11T00:00:01.000Z"));

  return {
    state,
    config,
    coder,
    reviewer,
    verify,
    collectChanges,
    changes,
    events,
    persisted,
    now,
    options(overrides: { signal?: AbortSignal } = {}) {
      return {
        state,
        artifacts: {
          runDirectory: "/artifacts",
          statePath: "/artifacts/state.json",
          eventsPath: "/artifacts/events.jsonl",
        },
        config,
        coder,
        reviewer,
        verify,
        collectChanges,
        now,
        persist: async (_artifacts: unknown, nextState: LoopState) => {
          persisted.push(structuredClone(nextState));
        },
        emit: async (_artifacts: unknown, event: RunEvent) => {
          events.push(event);
        },
        persistReview: async () => undefined,
        ...overrides,
      };
    },
  };
}

function passingVerification(): VerificationResult {
  return { passed: true, checks: [], durationMs: 1 };
}

function failedVerification(outputForModel: string): VerificationResult {
  const failedCheck = {
    name: "test",
    command: "npm test",
    passed: false,
    exitCode: 1,
    timedOut: false,
    stdoutBytes: 0,
    stderrBytes: outputForModel.length,
    outputForModel,
    fullOutputPath: "/missing/test.log",
    durationMs: 1,
  };
  return { passed: false, checks: [failedCheck], failedCheck, durationMs: 1 };
}
