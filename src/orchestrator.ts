import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReviewInputTooLargeError } from "./changes.js";
import { createFailureSignature } from "./failure.js";
import { toVerificationFeedback, type CoderRunner, type ReviewerRunner } from "./loop.js";
import { appendRunEvent, persistState } from "./preflight.js";
import { ReviewerProtocolError } from "./reviewer.js";
import type {
  ChangeSet,
  LoopState,
  PiLoopConfig,
  RunArtifacts,
  RunEvent,
  StopReason,
  ReviewResult,
  VerificationResult,
} from "./types.js";

export interface AbortableCoderRunner extends CoderRunner {
  abort(): Promise<void>;
}

export interface AbortableReviewerRunner extends ReviewerRunner {
  abort(): Promise<void>;
}

export interface RunStateMachineOptions {
  state: LoopState;
  artifacts: RunArtifacts;
  config: PiLoopConfig;
  coder: AbortableCoderRunner;
  reviewer: AbortableReviewerRunner;
  verify: (signal: AbortSignal) => Promise<VerificationResult>;
  collectChanges: () => Promise<ChangeSet>;
  signal?: AbortSignal;
  now?: () => Date;
  persist?: (artifacts: RunArtifacts, state: LoopState) => Promise<void>;
  emit?: (artifacts: RunArtifacts, event: RunEvent) => Promise<void>;
  persistReview?: (
    artifacts: RunArtifacts,
    cycle: number,
    review: ReviewResult,
  ) => Promise<void>;
}

export interface StateMachineResult {
  state: LoopState;
  changes?: ChangeSet;
}

class RunCancellationError extends Error {
  constructor(readonly kind: "timeout" | "interrupted") {
    super(kind === "timeout" ? "Global task timeout reached." : "Run interrupted.");
    this.name = "RunCancellationError";
  }
}

export async function runStateMachine(
  options: RunStateMachineOptions,
): Promise<StateMachineResult> {
  const state = options.state;
  const now = options.now ?? (() => new Date());
  const persist = options.persist ?? persistState;
  const emit = options.emit ?? appendRunEvent;
  const persistReview = options.persistReview ?? persistReviewArtifact;
  const deadline = Date.parse(state.startedAt) + options.config.limits.maxTaskMinutes * 60_000;
  let lastChanges: ChangeSet | undefined;

  const writeState = () => persist(options.artifacts, state);
  const writeEvent = (type: RunEvent["type"], data?: unknown) =>
    emit(options.artifacts, {
      eventId: randomUUID(),
      runId: state.runId,
      type,
      timestamp: now().toISOString(),
      ...(data === undefined ? {} : { data }),
    });

  const stop = async (reason: StopReason): Promise<StateMachineResult> => {
    state.status = "stopped";
    state.stopReason = reason;
    state.finishedAt = now().toISOString();
    await writeState();
    await writeEvent("run_stopped", { reason });
    return { state, ...(lastChanges ? { changes: lastChanges } : {}) };
  };

  const interrupt = async (): Promise<StateMachineResult> => {
    state.status = "interrupted";
    state.finishedAt = now().toISOString();
    delete state.stopReason;
    await writeState();
    await writeEvent("run_interrupted");
    return { state, ...(lastChanges ? { changes: lastChanges } : {}) };
  };

  try {
    while (true) {
      assertNotCancelled(options.signal, deadline, now);
      if (state.coderIteration >= options.config.limits.maxCoderIterations) {
        return await stop("max_coder_iterations");
      }

      state.status = "coding";
      await writeState();
      await writeEvent("coder_started", { iteration: state.coderIteration + 1 });
      await runCancellable(
        options.coder.run({
          taskRequirements: state.taskRequirements,
          ...(state.feedback ? { feedback: state.feedback } : {}),
        }),
        deadline,
        now,
        options.signal,
        () => options.coder.abort(),
      );
      state.coderIteration++;
      await writeEvent("coder_completed", { iteration: state.coderIteration });

      state.status = "verifying";
      await writeState();
      const verifierAbort = new AbortController();
      const verification = await runCancellable(
        options.verify(verifierAbort.signal),
        deadline,
        now,
        options.signal,
        () => verifierAbort.abort(),
      );
      state.lastVerification = verification;
      await writeEvent("verification_completed", {
        passed: verification.passed,
        checks: verification.checks.map((check) => ({
          name: check.name,
          passed: check.passed,
          exitCode: check.exitCode,
          timedOut: check.timedOut,
          fullOutputPath: check.fullOutputPath,
        })),
      });

      if (!verification.passed) {
        const failedCheck = verification.failedCheck;
        if (!failedCheck) return await stop("environment_failure");
        const signature = await createFailureSignature(failedCheck, {
          repoRoot: state.repoRoot,
          bounds: options.config.verification,
        });
        state.repeatedFailureCount =
          state.lastFailureSignature === signature ? state.repeatedFailureCount + 1 : 1;
        state.lastFailureSignature = signature;
        state.feedback = toVerificationFeedback(verification);
        await writeState();
        await writeEvent("feedback_sent", {
          type: state.feedback.type,
          failedCheck: state.feedback.failedCheck,
        });

        assertNotCancelled(options.signal, deadline, now);
        if (state.repeatedFailureCount >= options.config.limits.sameFailureLimit) {
          return await stop("repeated_verification_failure");
        }
        if (state.coderIteration >= options.config.limits.maxCoderIterations) {
          return await stop("max_coder_iterations");
        }
        continue;
      }

      state.repeatedFailureCount = 0;
      delete state.lastFailureSignature;
      lastChanges = await options.collectChanges();
      if (lastChanges.totalChars > options.config.reviewer.maxPatchChars) {
        return await stop("review_input_too_large");
      }

      state.status = "reviewing";
      await writeState();
      await writeEvent("review_started", {
        cycle: state.reviewCycle + 1,
        changedPaths: lastChanges.changedPaths,
        totalChars: lastChanges.totalChars,
      });
      const review = await runCancellable(
        options.reviewer.run({
          taskRequirements: state.taskRequirements,
          changes: lastChanges,
          verification,
        }),
        deadline,
        now,
        options.signal,
        () => options.reviewer.abort(),
      );
      state.reviewCycle++;
      state.lastReview = review;
      await persistReview(options.artifacts, state.reviewCycle, review);
      await writeEvent("review_completed", {
        cycle: state.reviewCycle,
        decision: review.decision,
        blockerCount: review.blockers.length,
      });

      if (review.decision === "approve") {
        state.status = "done";
        state.finishedAt = now().toISOString();
        delete state.feedback;
        delete state.stopReason;
        await writeState();
        await writeEvent("run_completed");
        return { state, changes: lastChanges };
      }

      state.feedback = { type: "review_blockers", blockers: review.blockers };
      await writeState();
      await writeEvent("feedback_sent", {
        type: state.feedback.type,
        blockerIds: review.blockers.map((blocker) => blocker.id),
      });
      assertNotCancelled(options.signal, deadline, now);
      if (state.reviewCycle >= options.config.limits.maxReviewCycles) {
        return await stop("max_review_cycles");
      }
      if (state.coderIteration >= options.config.limits.maxCoderIterations) {
        return await stop("max_coder_iterations");
      }
    }
  } catch (error) {
    if (error instanceof RunCancellationError) {
      return error.kind === "interrupted" ? await interrupt() : await stop("max_task_time");
    }
    if (error instanceof ReviewerProtocolError) return await stop("reviewer_protocol_error");
    if (error instanceof ReviewInputTooLargeError) return await stop("review_input_too_large");
    return await stop("environment_failure");
  }
}

export async function persistReviewArtifact(
  artifacts: RunArtifacts,
  cycle: number,
  review: ReviewResult,
): Promise<void> {
  const reviewDirectory = join(artifacts.runDirectory, "reviews");
  await mkdir(reviewDirectory, { recursive: true });
  const reviewPath = join(reviewDirectory, `review-${String(cycle).padStart(2, "0")}.json`);
  await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

function assertNotCancelled(
  signal: AbortSignal | undefined,
  deadline: number,
  now: () => Date,
): void {
  if (signal?.aborted) throw new RunCancellationError("interrupted");
  if (now().getTime() >= deadline) throw new RunCancellationError("timeout");
}

async function runCancellable<T>(
  operation: Promise<T>,
  deadline: number,
  now: () => Date,
  signal: AbortSignal | undefined,
  abort: () => void | Promise<void>,
): Promise<T> {
  if (signal?.aborted) {
    await abort();
    throw new RunCancellationError("interrupted");
  }
  if (now().getTime() >= deadline) {
    await abort();
    throw new RunCancellationError("timeout");
  }
  const remainingMs = Math.max(1, deadline - now().getTime());
  let timeout: NodeJS.Timeout | undefined;
  let onInterrupt: (() => void) | undefined;

  const cancellation = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      void Promise.resolve(abort()).finally(() => {
        reject(new RunCancellationError("timeout"));
      });
    }, remainingMs);
    timeout.unref();
    onInterrupt = () => {
      void Promise.resolve(abort()).finally(() => {
        reject(new RunCancellationError("interrupted"));
      });
    };
    signal?.addEventListener("abort", onInterrupt, { once: true });
  });

  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onInterrupt) signal?.removeEventListener("abort", onInterrupt);
  }
}
