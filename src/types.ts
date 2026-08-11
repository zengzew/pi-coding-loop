export type RunStatus =
  | "coding"
  | "verifying"
  | "reviewing"
  | "done"
  | "stopped"
  | "interrupted";

export interface VerificationCommand {
  name: string;
  command: string;
  timeoutMs: number;
}

export interface PiLoopConfig {
  coder: {
    provider: "deepseek";
    model: string;
  };
  reviewer: {
    provider: "moonshotai-cn";
    model: string;
    protocolRetries: number;
    maxPatchChars: number;
  };
  verification: {
    commands: VerificationCommand[];
    maxModelOutputChars: number;
    headLines: number;
    tailLines: number;
  };
  limits: {
    maxCoderIterations: number;
    maxReviewCycles: number;
    sameFailureLimit: number;
    maxTaskMinutes: number;
  };
}

export interface RunBaseline {
  repoRoot: string;
  baseCommit: string;
  branch: string | null;
}

export interface RunArtifacts {
  runDirectory: string;
  statePath: string;
  eventsPath: string;
}

export interface VerificationFeedback {
  type: "verification_failure";
  failedCheck: string;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  outputForModel: string;
  fullOutputPath: string;
}

export interface ReviewBlocker {
  id: string;
  file?: string;
  line?: number;
  issue: string;
  evidence: string;
  suggestedFix?: string;
}

export interface ReviewFeedback {
  type: "review_blockers";
  blockers: ReviewBlocker[];
}

export type Feedback = VerificationFeedback | ReviewFeedback;

export interface VerificationCheckResult {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number | null;
  timedOut: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  outputForModel: string;
  fullOutputPath: string;
  durationMs: number;
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheckResult[];
  failedCheck?: VerificationCheckResult;
  durationMs: number;
}

export interface ReviewResult {
  decision: "approve" | "changes_requested";
  blockers: ReviewBlocker[];
  notes: string[];
}

export interface ChangeSet {
  baseCommit: string;
  trackedDiff: string;
  untrackedFiles: {
    path: string;
    binary: boolean;
    sizeBytes: number;
    content?: string;
  }[];
  changedPaths: string[];
  totalChars: number;
}

export type StopReason =
  | "max_coder_iterations"
  | "max_review_cycles"
  | "max_task_time"
  | "repeated_verification_failure"
  | "reviewer_protocol_error"
  | "review_input_too_large"
  | "required_access_unavailable"
  | "environment_failure"
  | "configuration_error";

export interface LoopState {
  runId: string;
  taskPath: string;
  taskRequirements: string;
  repoRoot: string;
  baseCommit: string;
  status: RunStatus;
  coderIteration: number;
  reviewCycle: number;
  feedback?: Feedback;
  lastVerification?: VerificationResult;
  lastReview?: ReviewResult;
  lastFailureSignature?: string;
  repeatedFailureCount: number;
  startedAt: string;
  finishedAt?: string;
  stopReason?: StopReason;
}

export type RunEventType =
  | "run_started"
  | "coder_started"
  | "coder_completed"
  | "verification_completed"
  | "review_started"
  | "review_completed"
  | "feedback_sent"
  | "run_completed"
  | "run_stopped"
  | "run_interrupted";

export interface RunEvent<T = unknown> {
  eventId: string;
  runId: string;
  type: RunEventType;
  timestamp: string;
  data?: T;
}
