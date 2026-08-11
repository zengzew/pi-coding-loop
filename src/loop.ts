import type { CoderTurnInput } from "./coder.js";
import { assertReviewInputWithinLimit } from "./changes.js";
import type {
  ChangeSet,
  ReviewFeedback,
  ReviewResult,
  VerificationFeedback,
  VerificationResult,
} from "./types.js";
import type { ReviewerTurnInput } from "./reviewer.js";

export interface CoderRunner {
  readonly sessionId: string;
  run(input: CoderTurnInput): Promise<void>;
}

export interface ReviewerRunner {
  run(input: ReviewerTurnInput): Promise<ReviewResult>;
}

export interface RunCoderVerifierLoopOptions {
  coder: CoderRunner;
  taskRequirements: string;
  maxCoderIterations: number;
  verify: () => Promise<VerificationResult>;
}

export interface CoderVerifierLoopResult {
  status: "verification_passed" | "coder_iterations_exhausted";
  coderIterations: number;
  verifications: VerificationResult[];
  feedback?: VerificationFeedback;
}

export interface RunCoderVerifierReviewerLoopOptions {
  coder: CoderRunner;
  reviewer: ReviewerRunner;
  taskRequirements: string;
  maxCoderIterations: number;
  maxReviewCycles: number;
  maxPatchChars: number;
  verify: () => Promise<VerificationResult>;
  collectChanges: () => Promise<ChangeSet>;
}

export interface CoderVerifierReviewerLoopResult {
  status: "approved" | "coder_iterations_exhausted" | "review_cycles_exhausted";
  coderIterations: number;
  reviewCycles: number;
  verifications: VerificationResult[];
  reviews: ReviewResult[];
  feedback?: VerificationFeedback | ReviewFeedback;
  changes?: ChangeSet;
}

export async function runCoderVerifierLoop(
  options: RunCoderVerifierLoopOptions,
): Promise<CoderVerifierLoopResult> {
  if (!options.taskRequirements.trim()) {
    throw new TypeError("Coder-Verifier task requirements must not be empty.");
  }
  if (!Number.isInteger(options.maxCoderIterations) || options.maxCoderIterations <= 0) {
    throw new TypeError("maxCoderIterations must be a positive integer.");
  }

  const verifications: VerificationResult[] = [];
  let feedback: VerificationFeedback | undefined;

  for (let iteration = 1; iteration <= options.maxCoderIterations; iteration++) {
    await options.coder.run({
      taskRequirements: options.taskRequirements,
      ...(feedback ? { feedback } : {}),
    });

    const verification = await options.verify();
    verifications.push(verification);
    if (verification.passed) {
      return {
        status: "verification_passed",
        coderIterations: iteration,
        verifications,
      };
    }
    feedback = toVerificationFeedback(verification);
  }

  return {
    status: "coder_iterations_exhausted",
    coderIterations: options.maxCoderIterations,
    verifications,
    feedback: feedback!,
  };
}

export async function runCoderVerifierReviewerLoop(
  options: RunCoderVerifierReviewerLoopOptions,
): Promise<CoderVerifierReviewerLoopResult> {
  assertLoopInputs(options.taskRequirements, options.maxCoderIterations);
  if (!Number.isInteger(options.maxReviewCycles) || options.maxReviewCycles <= 0) {
    throw new TypeError("maxReviewCycles must be a positive integer.");
  }

  const verifications: VerificationResult[] = [];
  const reviews: ReviewResult[] = [];
  let feedback: VerificationFeedback | ReviewFeedback | undefined;
  let changes: ChangeSet | undefined;

  for (let iteration = 1; iteration <= options.maxCoderIterations; iteration++) {
    await options.coder.run({
      taskRequirements: options.taskRequirements,
      ...(feedback ? { feedback } : {}),
    });
    const verification = await options.verify();
    verifications.push(verification);
    if (!verification.passed) {
      feedback = toVerificationFeedback(verification);
      continue;
    }

    changes = await options.collectChanges();
    assertReviewInputWithinLimit(changes, options.maxPatchChars);
    const review = await options.reviewer.run({
      taskRequirements: options.taskRequirements,
      changes,
      verification,
    });
    reviews.push(review);
    if (review.decision === "approve") {
      return {
        status: "approved",
        coderIterations: iteration,
        reviewCycles: reviews.length,
        verifications,
        reviews,
        changes,
      };
    }

    feedback = { type: "review_blockers", blockers: review.blockers };
    if (reviews.length >= options.maxReviewCycles) {
      return {
        status: "review_cycles_exhausted",
        coderIterations: iteration,
        reviewCycles: reviews.length,
        verifications,
        reviews,
        feedback,
        changes,
      };
    }
  }

  return {
    status: "coder_iterations_exhausted",
    coderIterations: options.maxCoderIterations,
    reviewCycles: reviews.length,
    verifications,
    reviews,
    ...(feedback ? { feedback } : {}),
    ...(changes ? { changes } : {}),
  };
}

export function toVerificationFeedback(
  verification: VerificationResult,
): VerificationFeedback {
  if (verification.passed || !verification.failedCheck) {
    throw new TypeError("A failed VerificationResult with failedCheck is required.");
  }
  const failedCheck = verification.failedCheck;
  return {
    type: "verification_failure",
    failedCheck: failedCheck.name,
    command: failedCheck.command,
    exitCode: failedCheck.exitCode,
    timedOut: failedCheck.timedOut,
    outputForModel: failedCheck.outputForModel,
    fullOutputPath: failedCheck.fullOutputPath,
  };
}

function assertLoopInputs(taskRequirements: string, maxCoderIterations: number): void {
  if (!taskRequirements.trim()) {
    throw new TypeError("Coder-Verifier-Reviewer task requirements must not be empty.");
  }
  if (!Number.isInteger(maxCoderIterations) || maxCoderIterations <= 0) {
    throw new TypeError("maxCoderIterations must be a positive integer.");
  }
}
