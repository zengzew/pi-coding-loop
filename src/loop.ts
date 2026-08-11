import type { CoderTurnInput } from "./coder.js";
import type {
  VerificationFeedback,
  VerificationResult,
} from "./types.js";

export interface CoderRunner {
  readonly sessionId: string;
  run(input: CoderTurnInput): Promise<void>;
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
